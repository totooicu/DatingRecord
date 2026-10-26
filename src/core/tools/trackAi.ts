// 轨迹提取的「AI 校准」：让视觉模型看同一张截图，给出一份独立的轨迹与校准依据。
//
// 为什么要再做一遍：像素阈值法只认「红色细线」，对截图的缩放、底图配色、被 UI 遮挡
// 的段落很敏感；视觉模型相反——它认路线形状、地名和比例尺，但像素级精度不稳。
// 两者叠在一张图上对比，差异大的地方就是「该人工看一眼」的地方，这比单纯调阈值可靠。
//
// 模型返回的东西（严格 JSON）：
//   · polyline：沿路线从起点到终点的有序比例坐标（0~1），40~80 个点就够；
//   · scale / mileageKm：截图里如果有比例尺或官方里程，抄下来当校准依据；
//   · startGeo / endGeo：如果截图上能读出确切地点（有地图、有地名），给出经纬度；
//   · northDeg：图上的正北方向相对屏幕正上方的角度，落图时用来把截图旋到正北。
//
// 只发用户自己配置的模型，截图不出浏览器之外的别处；解析失败就当没校准成功。

import { chat, type AiContentPart, type AiModel, type AiMessage } from '../ai';

export interface AiTrackResult {
  /** 沿路线的有序点（截图比例坐标 0~1） */
  polyline: { x: number; y: number }[];
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
  /** 模型的简短说明（哪里不确定、依据是什么） */
  notes: string;
  /** 用的哪个模型（展示用） */
  model: string;
}

const PROMPT = `你是一名轨迹提取助手。图片是「两步路」等户外 App 的轨迹截图。
请只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块。字段：
{
  "polyline": [{"x":0.12,"y":0.35}, ...],   // 沿红色轨迹线从起点到终点的有序点，坐标是相对图片宽高的比例(0~1)，40~80 个点，必须首尾相接地贴合轨迹
  "scale": {"meter": 500, "px": 200} | null, // 截图里的比例尺，读不出就 null
  "mileageKm": 8.6 | null,                    // 截图里的官方里程（公里），读不出就 null
  "startName": "起点地名或空串",
  "endName": "终点地名或空串",
  "startGeo": {"lat": 30.1234, "lng": 120.1234} | null, // 只有图上能确定具体地点时才给（GCJ-02）
  "endGeo": {"lat": 0, "lng": 0} | null,
  "northDeg": 0 | null,      // 图上指北针/地图正北相对「屏幕正上方」的顺时针角度，0~360；看不出就 null
  "notes": "一句话说明依据与不确定处"
}
注意：polyline 要贴着红色线走，不要走直线抄近路；不要包含图例、比例尺、关闭按钮。`;

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

/** 归一化结果：去掉越界点、太少的直接判失败 */
function normalize(raw: unknown, model: string): AiTrackResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(o.polyline) ? o.polyline : [];
  const polyline = list
    .map((p) => (p && typeof p === 'object' ? { x: num((p as any).x), y: num((p as any).y) } : null))
    .filter((p): p is { x: number; y: number } => !!p && p.x !== null && p.y !== null)
    .map((p) => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }));
  if (polyline.length < 2) throw new Error('模型没给出可用的轨迹线（polyline 少于 2 点）');
  const sc = o.scale as { meter?: unknown; px?: unknown } | null | undefined;
  const scale =
    sc && num(sc.meter) && num(sc.px) && (sc.meter as number) > 0 && (sc.px as number) > 0
      ? { meter: sc.meter as number, px: sc.px as number }
      : null;
  const north = num(o.northDeg);
  return {
    polyline,
    scale,
    mileageKm: num(o.mileageKm),
    startName: typeof o.startName === 'string' ? o.startName.slice(0, 40) : '',
    endName: typeof o.endName === 'string' ? o.endName.slice(0, 40) : '',
    startGeo: toGeo(o.startGeo),
    endGeo: toGeo(o.endGeo),
    northDeg: north === null ? null : ((north % 360) + 360) % 360,
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

export interface AiTrackInput {
  /** 已经缩到模型能接受尺寸的 data URL（jpeg） */
  dataUrl: string;
  width: number;
  height: number;
}

/** 调一次模型，拿回「AI 的轨迹 + 校准依据」 */
export async function aiExtractTrack(
  model: AiModel,
  shot: AiTrackInput,
  opts: { signal?: AbortSignal } = {},
): Promise<AiTrackResult> {
  const parts: AiContentPart[] = [
    { type: 'text', text: `${PROMPT}\n图片尺寸：${shot.width}×${shot.height}（比例坐标请按这个宽高换算，不用你算像素）。` },
    { type: 'image_url', image_url: { url: shot.dataUrl } },
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
  return normalize(parseJson(reply.content), model.alias);
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
