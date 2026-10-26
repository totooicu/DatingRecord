// 轨迹提取的「AI 优化」：在「参数自动校准」的结果上，对照原图做增删改。
//
// 为什么不再让模型独立画一条线：像素阈值法已经把「红色轨迹在哪」这件事做得很准，
// 它的错误集中在三类——被打断、被图标骗、整段偏一点。让视觉模型从零描线，等于把
// 已经正确的部分也重算一遍，偏差反而更大，还没法判断「改了什么」。
//
// 所以这里喂给模型两样东西：同一张截图 + 当前点列（带原始下标）。它只需要返回
// **最小必要修改**：
//   · insert：断口/抄近路的地方补点；
//   · delete：把红色 POI、图例、关闭按钮当成轨迹的点删掉；
//   · move：整段贴不到红线上时挪一下。
// 返回里还有 reasoning（它的思考过程），页面上直接展示，改哪几处、为什么改一目了然。
//
// 只发用户自己配置的模型；没有 edits 或解析失败就当没优化成功。

import { chat, type AiContentPart, type AiModel, type AiMessage } from '../ai';
import type { TrackPoint } from './trackExtract';

export type EditOp = 'move' | 'delete' | 'insert';

export interface TrackEdit {
  op: EditOp;
  /** 基准点下标（原始点列里的 index；insert 表示插在它后面） */
  index: number;
  /** 归一化坐标 0~1；move / insert 必填 */
  x: number | null;
  y: number | null;
  reason: string;
}

/** AI 优化后需要人工看一眼的标记点（画在对比图上） */
export interface EditMark {
  x: number;
  y: number;
  kind: 'add' | 'del' | 'move';
}

export interface AiTrackResult {
  /** 模型给出的增删改（已按点列校验过下标） */
  edits: TrackEdit[];
  /** 截图比例尺：meter 米 = px 像素 */
  scale: { meter: number; px: number } | null;
  /** 截图里写的官方里程（公里） */
  mileageKm: number | null;
  startName: string;
  endName: string;
  /** 能读出确切地点时的经纬度（GCJ-02，和本库一致） */
  startGeo: { lat: number; lng: number } | null;
  endGeo: { lat: number; lng: number } | null;
  /** 图上的正北相对屏幕正上方的顺时针角度（度）；0 = 截图正上方就是正北 */
  northDeg: number | null;
  /** 模型的思考过程：先看到什么、点列哪里不对、决定改哪几处 */
  thinking: string;
  /** 模型的简短说明（哪里不确定、依据是什么） */
  notes: string;
  /** 用的哪个模型（展示用） */
  model: string;
}

const PROMPT = `你是一名轨迹精修助手。图片是「两步路」等户外 App 的行程截图，红色线是真实轨迹。
下面会给出「参数自动校准后」的像素阈值提取结果：一串有序点，坐标已归一化到 0~1，
index 是该点在原始点列里的下标。这个结果通常只有三类错误，请做**最小必要修改**：
  1) 被底图或图标打断、或在岔口抄了近路 → 用 insert 在缺口处补点；
  2) 把红色 POI、图例、左上角关闭按钮当成了轨迹 → 用 delete 删掉这些点；
  3) 整段贴不到红线上、或平移了一段 → 用 move 把这些点挪到红线上。
只改你有把握的地方，不要整条重画，也不要改变点的整体顺序和走向。
请只输出一个 JSON 对象，不要解释文字、不要 markdown 代码块：
{
  "reasoning": "你的思考过程：先写图上看到什么，再写点列哪里不对，最后写决定改哪几处，中文 100~400 字",
  "edits": [
    {"op":"move","index":12,"x":0.5123,"y":0.4211,"reason":"这一段整体偏左，实际红线在这边"},
    {"op":"delete","index":30,"reason":"这里取到了红色 POI 图标，不是轨迹"},
    {"op":"insert","index":40,"x":0.61,"y":0.37,"reason":"两点之间缺一段弯道"}
  ],
  "scale": {"meter": 500, "px": 200} | null,
  "mileageKm": 8.6 | null,
  "startName": "起点地名或空串",
  "endName": "终点地名或空串",
  "startGeo": {"lat": 30.1234, "lng": 120.1234} | null,
  "endGeo": {"lat": 0, "lng": 0} | null,
  "northDeg": 0 | null,
  "notes": "一句话说明依据与不确定处"
}
约束：index 必须来自给出的点列；insert 表示插在该点之后；x/y 是相对图片宽高的比例(0~1)；
同一个 index 不要既 move 又 delete；没有要改的就返回空数组 edits。`;

/** 从模型回复里抠出 JSON（容忍代码块与前后废话） */
function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON');
  return JSON.parse(t.slice(start, end + 1));
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toGeo(v: unknown): { lat: number; lng: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { lat?: unknown; lng?: unknown };
  const lat = num(o.lat);
  const lng = num(o.lng);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** 归一化 edits：丢越界下标、丢缺坐标的 move/insert、按下标去重 */
function normalizeEdits(raw: unknown, count: number): TrackEdit[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Map<number, EditOp>();
  const out: TrackEdit[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const op = o.op;
    if (op !== 'move' && op !== 'delete' && op !== 'insert') continue;
    const index = num(o.index);
    if (index === null || !Number.isInteger(index) || index < 0 || index >= count) continue;
    const x = num(o.x);
    const y = num(o.y);
    if (op !== 'delete' && (x === null || y === null)) continue;
    const prev = seen.get(index);
    if (prev) continue;
    seen.set(index, op);
    out.push({
      op,
      index,
      x: x === null ? null : Math.max(0, Math.min(1, x)),
      y: y === null ? null : Math.max(0, Math.min(1, y)),
      reason: typeof o.reason === 'string' ? o.reason.slice(0, 120) : '',
    });
    if (out.length >= 600) break;
  }
  return out;
}

function normalize(raw: unknown, model: string, count: number): AiTrackResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const sc = o.scale as { meter?: unknown; px?: unknown } | null | undefined;
  const scale =
    sc && num(sc.meter) && num(sc.px) && (sc.meter as number) > 0 && (sc.px as number) > 0
      ? { meter: sc.meter as number, px: sc.px as number }
      : null;
  const north = num(o.northDeg);
  return {
    edits: normalizeEdits(o.edits, count),
    scale,
    mileageKm: num(o.mileageKm),
    startName: typeof o.startName === 'string' ? o.startName.slice(0, 40) : '',
    endName: typeof o.endName === 'string' ? o.endName.slice(0, 40) : '',
    startGeo: toGeo(o.startGeo),
    endGeo: toGeo(o.endGeo),
    northDeg: north === null ? null : ((north % 360) + 360) % 360,
    thinking: typeof o.reasoning === 'string' ? o.reasoning.slice(0, 4000) : '',
    notes: typeof o.notes === 'string' ? o.notes.slice(0, 300) : '',
    model,
  };
}

/** 默认挑一个能看图的模型 */
export function pickVisionModel(models: AiModel[], prefer?: string): AiModel | null {
  const img = models.filter((m) => m.capabilities.includes('image'));
  if (prefer) {
    const hit = img.find((m) => m.alias === prefer);
    if (hit) return hit;
  }
  return img[0] ?? null;
}

/** 送给模型的最多点数：再多只是烧 token，抽样时保留首尾 */
const MAX_SENT = 160;

export interface AiRefineInput {
  /** 已经缩到模型能接受尺寸的 data URL（jpeg） */
  dataUrl: string;
  width: number;
  height: number;
  /** 原图像素尺寸（edits 里的 0~1 坐标按它还原） */
  imageW: number;
  imageH: number;
  /** 当前算法结果（像素坐标，已按断口串成一条） */
  points: TrackPoint[];
  /** 当前定标：米/像素与断口数，帮模型判断尺度 */
  mPerPx: number;
  mileageKm: number;
  segments: number;
  gaps: number;
}

/** 抽样成 {index,x,y}，index 始终指向原始点列 */
function sampleForPrompt(pts: TrackPoint[], w: number, h: number): { index: number; x: number; y: number }[] {
  const n = pts.length;
  if (n === 0) return [];
  const step = Math.max(1, Math.ceil(n / MAX_SENT));
  const out: { index: number; x: number; y: number }[] = [];
  for (let i = 0; i < n; i += step) {
    out.push({ index: i, x: Number((pts[i].x / w).toFixed(4)), y: Number((pts[i].y / h).toFixed(4)) });
  }
  if (out[out.length - 1]?.index !== n - 1) {
    const last = pts[n - 1];
    out.push({ index: n - 1, x: Number((last.x / w).toFixed(4)), y: Number((last.y / h).toFixed(4)) });
  }
  return out;
}

/** 调一次模型，拿回「最小必要修改 + 它的思考过程 + 校准依据」 */
export async function refineTrack(
  model: AiModel,
  input: AiRefineInput,
  opts: { signal?: AbortSignal } = {},
): Promise<AiTrackResult> {
  const sample = sampleForPrompt(input.points, input.imageW, input.imageH);
  if (sample.length < 2) throw new Error('当前结果点太少，没法交给模型优化');
  const facts = [
    `图片尺寸：${input.width}×${input.height}（比例坐标按图片宽高换算，不用你算像素）。`,
    `当前定标：${input.mPerPx > 0 ? `${input.mPerPx.toFixed(3)} 米/像素` : '未定标'}` +
      `${input.mileageKm > 0 ? `，官方里程 ${input.mileageKm} 公里` : ''}` +
      `；提取结果 ${input.segments} 段、${input.gaps} 处断口、共 ${input.points.length} 点。`,
    `下面抽样 ${sample.length} 个点（未列出的点请勿修改），index 即原始下标：`,
    JSON.stringify(sample),
  ].join('\n');

  const parts: AiContentPart[] = [
    { type: 'text', text: `${PROMPT}\n\n${facts}` },
    { type: 'image_url', image_url: { url: input.dataUrl } },
  ];
  const messages: AiMessage[] = [{ role: 'user', content: parts }];
  const reply = await chat(model, {
    messages,
    temperature: 0.1,
    maxTokens: Math.max(model.maxTokens ?? 0, 4096),
    signal: opts.signal,
    toolChoice: 'none',
  });
  if (!reply.content.trim()) throw new Error('模型没有返回内容');
  const res = normalize(parseJson(reply.content), model.alias, input.points.length);
  // 有些服务商把思维链单独放在 reasoning_content 里；JSON 里没有就补上
  if (!res.thinking && reply.reasoning) res.thinking = reply.reasoning.slice(0, 4000);
  return res;
}

export interface ApplyResult {
  points: TrackPoint[];
  marks: EditMark[];
  added: number;
  removed: number;
  moved: number;
}

/**
 * 把 edits 应用到点列上。
 * 一次遍历完成：按原始下标决定「保留 / 替换 / 删除」，再按插入表追加新点，
 * 所以同一 index 的增改删互不影响，输出顺序也不变。
 */
export function applyEdits(
  pts: TrackPoint[],
  edits: TrackEdit[],
  w: number,
  h: number,
): ApplyResult {
  const moves = new Map<number, TrackPoint>();
  const dels = new Set<number>();
  const ins = new Map<number, TrackPoint[]>();
  const marks: EditMark[] = [];
  let moved = 0;
  let removed = 0;
  let added = 0;

  for (const e of edits) {
    if (e.index < 0 || e.index >= pts.length) continue;
    if (e.op === 'delete') {
      dels.add(e.index);
      const p = pts[e.index];
      marks.push({ x: p.x, y: p.y, kind: 'del' });
      removed += 1;
    } else {
      const p = { x: (e.x ?? 0) * w, y: (e.y ?? 0) * h };
      if (e.op === 'move') {
        moves.set(e.index, p);
        marks.push({ x: p.x, y: p.y, kind: 'move' });
        moved += 1;
      } else {
        const list = ins.get(e.index) ?? [];
        list.push(p);
        ins.set(e.index, list);
        marks.push({ x: p.x, y: p.y, kind: 'add' });
        added += 1;
      }
    }
  }

  const out: TrackPoint[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    if (!dels.has(i)) out.push(moves.get(i) ?? pts[i]);
    const after = ins.get(i);
    if (after) out.push(...after);
  }
  return { points: out, marks, added, removed, moved };
}

/**
 * 把截图缩到「长边不超过 maxSide」的 jpeg data URL。
 * 直接发原图有两个问题：base64 太大（几 MB，很多模型直接拒）、而且模型对
 * 4000px 宽的图也是先缩放，纯属浪费带宽。
 */
export async function prepareShot(
  dataUrl: string,
  maxSide = 1400,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(dataUrl);
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持 canvas');
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.86), width: w, height: h };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}
