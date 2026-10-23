// 聊天截图提取：把一张或多张聊天截图变成「聊天形式」的事件。
//
// 分工：
//   · 模型看截图，抄下每条消息的说话人 / 左右 / 文字，并给出图片在截图里的位置；
//   · 浏览器按位置把图片裁出来，存进本库文件（正文里用 ![](file:xxx) 引用）；
//   · 最后用事件 + 消息表落库，视图切成 chat——和手动记的聊天事件完全一样。
//
// 图片必须真的裁下来，而不是把整张截图塞进消息：截图里有输入框、状态栏、
// 别人的头像，整张贴进去既难看又泄露无关信息。裁图用 canvas 在本机完成，
// 截图本身不上传服务器（只发给用户自己配置的模型）。

import { chat, type AiContentPart, type AiModel } from '../ai';
import { listPersons } from '../repo/persons';
import { createPerson } from '../repo/persons/write';
import { createEvent } from '../repo/events';
import { appendMessage } from '../repo/chat';
import { DEFAULT_SMALL_LIMIT, uploadFileQuiet } from '../files';
import type { StoredFile } from '../repo/files';

/** 一张截图（已经缩到模型能接受的尺寸） */
export interface Shot {
  key: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}

/** 图片在截图里的归一化位置：左上角 + 宽高，0~1 */
export interface ImageBox {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExtractedMessage {
  speaker: string;
  side: 'left' | 'right';
  text: string;
  time?: string | null;
  image?: ImageBox | null;
}

export interface ExtractedChat {
  title: string;
  time?: string | null;
  messages: ExtractedMessage[];
}

export interface PreviewMessage {
  side: 'left' | 'right';
  speaker: string;
  text: string;
  imageUrl?: string;
}

export interface SavedExtraction {
  eventId: string;
  title: string;
  messageCount: number;
  imageCount: number;
  preview: PreviewMessage[];
  warnings: string[];
}

/** 截图最长边压到多少再发给模型：太大既慢又贵，视觉模型也不需要原图 */
const MAX_SIDE = 1600;
const MAX_MODEL_MESSAGES = 300;

const SELF_NAMES = new Set(['我', '自己', '本人', 'me', 'Me', 'ME', 'i', 'I']);

export function isSelfSpeaker(name: string): boolean {
  return SELF_NAMES.has(name.trim());
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ''));
    fr.onerror = () => reject(fr.error ?? new Error('读取图片失败'));
    fr.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = src;
  });
}

/**
 * 读一张截图：小图原样用，大图等比缩到 1600px。
 * 缩放后的图同时用于「给模型看」和「按 bbox 裁图」，坐标才对得上。
 */
export async function readShot(file: File, key: string): Promise<Shot> {
  const raw = await readDataUrl(file);
  const img = await loadImage(raw);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest <= MAX_SIDE) {
    return { key, name: file.name, dataUrl: raw, width: img.naturalWidth, height: img.naturalHeight };
  }
  const scale = MAX_SIDE / longest;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { key, name: file.name, dataUrl: raw, width: img.naturalWidth, height: img.naturalHeight };
  ctx.drawImage(img, 0, 0, w, h);
  return { key, name: file.name, dataUrl: canvas.toDataURL('image/jpeg', 0.88), width: w, height: h };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 模型给的框可能是 0~1、0~100、数组、{x1,y1,x2,y2}，统一成 ImageBox */
function normalizeBox(raw: unknown, pageCount: number): ImageBox | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const page = Math.max(0, Math.min(pageCount - 1, Math.round(num(o.page ?? o.shot ?? 0) ?? 0)));

  let x: number | null = null;
  let y: number | null = null;
  let w: number | null = null;
  let h: number | null = null;

  const arr = Array.isArray(raw) ? raw : null;
  if (arr && arr.length >= 4) {
    x = num(arr[0]);
    y = num(arr[1]);
    w = num(arr[2]);
    h = num(arr[3]);
  } else if (o.bbox || o.box) {
    return normalizeBox(o.bbox ?? o.box, pageCount);
  } else {
    x = num(o.x ?? o.left);
    y = num(o.y ?? o.top);
    w = num(o.w ?? o.width);
    h = num(o.h ?? o.height);
    const x2 = num(o.x2 ?? o.right);
    const y2 = num(o.y2 ?? o.bottom);
    if ((w === null || h === null) && x !== null && y !== null && x2 !== null && y2 !== null) {
      w = x2 - x;
      h = y2 - y;
    }
  }
  if (x === null || y === null || w === null || h === null) return null;
  // 有的模型按百分比给（0~100），统一到 0~1
  if ([x, y, w, h].some((v) => v > 1.5)) {
    x /= 100;
    y /= 100;
    w /= 100;
    h /= 100;
  }
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  x = clamp(x);
  y = clamp(y);
  w = clamp(w);
  h = clamp(h);
  if (w < 0.01 || h < 0.01) return null;
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  if (w < 0.01 || h < 0.01) return null;
  return { page, x, y, w, h };
}

/** 从模型回复里抠出 JSON：允许 ```json 围栏、前后解释文字 */
function parseJsonReply(raw: string): Record<string, unknown> {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('模型没有返回 JSON');
  const obj = JSON.parse(s.slice(a, b + 1)) as unknown;
  if (!obj || typeof obj !== 'object') throw new Error('模型返回的 JSON 不是对象');
  return obj as Record<string, unknown>;
}

function normalizeChat(obj: Record<string, unknown>, shotCount: number): ExtractedChat {
  const rawMessages =
    (Array.isArray(obj.messages) ? obj.messages : null) ??
    (Array.isArray(obj.dialog) ? obj.dialog : null) ??
    (Array.isArray(obj.conversation) ? obj.conversation : null) ??
    [];
  const messages: ExtractedMessage[] = [];

  for (const raw of rawMessages) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    if (m.type === 'divider' || m.type === 'narration') {
      continue;
    }
    const speaker = str(m.speaker ?? m.name ?? m.from ?? m.author) || '对方';
    const sideRaw = str(m.side).toLowerCase();
    const side: 'left' | 'right' =
      sideRaw === 'right' || sideRaw === 'out' || sideRaw === 'mine' || isSelfSpeaker(speaker)
        ? 'right'
        : 'left';
    let text = str(m.text ?? m.content ?? m.message ?? m.body);
    const image = normalizeBox(m.image ?? m.img ?? m.img_box ?? m.bbox ?? null, shotCount);
    // 图片消息常见的占位文字：有图就把 [图片] 去掉，只留图
    if (image && /^\[?(图片|照片|image|photo|img|图片消息)\]?$/i.test(text)) text = '';
    if (!text && !image) continue;
    messages.push({
      speaker,
      side,
      text,
      ...(m.time !== undefined ? { time: str(m.time) || null } : {}),
      image,
    });
  }

  if (!messages.length) {
    throw new Error('没有从截图里读出消息。换清晰一点的截图，或在提示词里说明对话在哪里。');
  }
  const title = str(obj.title) || `聊天记录 · ${new Date().toLocaleDateString('zh-CN')}`;
  const time = str(obj.time ?? obj.date) || null;
  return { title, time, messages: messages.slice(0, MAX_MODEL_MESSAGES) };
}

function buildPrompt(userPrompt: string, shotCount: number): string {
  return [
    '你是聊天截图整理助手。看下面这些聊天截图，把对话原样还原成结构化 JSON。',
    '只输出 JSON，不要解释、不要 markdown 代码块。',
    '',
    '格式：',
    '{',
    '  "title": "一句话概括这段对话，例如：和林小满聊周末爬山",',
    '  "time": "截图里能看到的日期时间（ISO8601），看不到就 null",',
    '  "messages": [',
    '    {',
    '      "speaker": "说话人昵称；自己发的写「我」",',
    '      "side": "right 或 left",',
    `      "text": "原样抄写，保留表情文字，不要翻译、不要补全", `,
    `      "image": { "page": 0, "x": 0.12, "y": 0.35, "w": 0.62, "h": 0.28 } 或 null`,
    '    }',
    '  ]',
    '}',
    '',
    `一共有 ${shotCount} 张截图，page 从 0 开始，对应第几张。`,
    'image 是「图片 / 表情包 / 照片」在截图里的外框：x y 是左上角，w h 是宽高，都按整张截图归一化到 0~1。',
    '只有真的是一张图片时才给 image；纯文字消息填 null。',
    '规则：',
    '1. 按截图里从上到下的顺序输出每条消息，连续同一个人也要分开成多条，不要合并。',
    '2. side 按气泡方向判断：自己发的在右边写 right，对方在左边写 left。',
    '3. 忽略系统提示、时间戳、输入框、底部按钮、手机状态栏。',
    '4. 说话人用截图里的昵称；分不清就用「对方」。',
    '5. 表情包、照片、截图等非文字内容：text 留空，image 给出位置。',
    '6. 不要编造截图里没有的内容。',
    userPrompt.trim() ? `\n用户额外要求：${userPrompt.trim()}` : '',
  ].join('\n');
}

/** 调模型，读截图，返回结构化对话 */
export async function extractChat(opts: {
  model: AiModel;
  shots: Shot[];
  prompt: string;
  signal?: AbortSignal;
}): Promise<ExtractedChat> {
  if (!opts.shots.length) throw new Error('先选几张聊天截图');
  const parts: AiContentPart[] = [
    { type: 'text', text: buildPrompt(opts.prompt, opts.shots.length) },
    ...opts.shots.map((s) => ({ type: 'image_url' as const, image_url: { url: s.dataUrl } })),
  ];
  const reply = await chat(opts.model, {
    messages: [{ role: 'user', content: parts }],
    temperature: 0.1,
    maxTokens: Math.max(opts.model.maxTokens ?? 0, 4096),
    signal: opts.signal,
    toolChoice: 'none',
  });
  if (!reply.content.trim()) throw new Error('模型没有返回内容');
  return normalizeChat(parseJsonReply(reply.content), opts.shots.length);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/png';
  const bin = atob(body ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** 按归一化框从截图里裁一块，返回 PNG data URL */
async function cropShot(shot: Shot, box: ImageBox): Promise<string | null> {
  const img = await loadImage(shot.dataUrl);
  const x = Math.round(box.x * img.naturalWidth);
  const y = Math.round(box.y * img.naturalHeight);
  const w = Math.max(2, Math.round(box.w * img.naturalWidth));
  const h = Math.max(2, Math.round(box.h * img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}

/** 在已有的人物里按姓名 / 别名找，找不到就新建一个（打上「聊天提取」标签，方便事后清理） */
function personForSpeaker(name: string, cache: Map<string, string>): string | null {
  const hit = cache.get(name);
  if (hit !== undefined) return hit || null;
  const clean = name.trim();
  if (!clean || isSelfSpeaker(clean)) {
    cache.set(name, '');
    return null;
  }
  const found = listPersons({ keyword: clean }).find(
    (p) => p.displayName === clean || p.aliases.includes(clean),
  );
  if (found) {
    cache.set(name, found.id);
    return found.id;
  }
  const created = createPerson({ displayName: clean, tags: ['聊天提取'] });
  cache.set(name, created.id);
  return created.id;
}

function eventTime(raw: string | null | undefined): { kind: 'instant'; start: string; precision: 'minute' } | { kind: 'unknown' } {
  const text = (raw ?? '').trim();
  if (text) {
    const t = new Date(text);
    if (Number.isFinite(t.getTime())) {
      return { kind: 'instant', start: t.toISOString(), precision: 'minute' };
    }
  }
  return { kind: 'unknown' };
}

/**
 * 把提取结果落成一个聊天事件：裁图 → 存文件 → 建人物 → 建事件 → 逐条消息。
 *
 * 图片裁不出来时不让整批失败：记一条 warning，消息照常入库，用户事后能补。
 */
export async function saveExtraction(
  extracted: ExtractedChat,
  shots: Shot[],
  selfPersonId?: string | null,
): Promise<SavedExtraction> {
  const warnings: string[] = [];
  const cache = new Map<string, string>();
  const preview: PreviewMessage[] = [];
  const personIds = new Map<string, string | null>();
  let imageCount = 0;

  const bodies: string[] = [];
  for (let i = 0; i < extracted.messages.length; i += 1) {
    const m = extracted.messages[i];
    let body = m.text;
    let imageUrl: string | undefined;

    if (m.image) {
      const shot = shots[m.image.page];
      if (!shot) {
        warnings.push(`第 ${i + 1} 条图片指到了不存在的截图，已只保留文字`);
      } else {
        try {
          const dataUrl = await cropShot(shot, m.image);
          if (!dataUrl) throw new Error('裁图失败');
          imageUrl = dataUrl;
          const file: StoredFile = await uploadFileQuiet(
            new File([dataUrlToBlob(dataUrl)], `聊天图片-${i + 1}.png`, { type: 'image/png' }),
            DEFAULT_SMALL_LIMIT,
          );
          body = body ? `${body}\n\n![图片](file:${file.id})` : `![图片](file:${file.id})`;
          imageCount += 1;
        } catch (e) {
          warnings.push(`第 ${i + 1} 条图片没裁下来：${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    const self = m.side === 'right' || isSelfSpeaker(m.speaker);
    const personId = self ? (selfPersonId ?? null) : personForSpeaker(m.speaker, cache);
    personIds.set(m.speaker, personId);
    bodies.push(body);
    preview.push({
      side: m.side,
      speaker: self ? m.speaker || '我' : m.speaker,
      text: m.text,
      ...(imageUrl ? { imageUrl } : {}),
    });
  }

  const participantIds = [...new Set([...personIds.values()].filter((id): id is string => !!id))];
  const event = createEvent({
    title: extracted.title || '聊天记录',
    kind: 'chat',
    time: eventTime(extracted.time),
    participants: participantIds.map((personId) => ({
      personId,
      role: selfPersonId && personId === selfPersonId ? 'self' : 'primary',
    })),
    tags: ['聊天提取'],
    viewMode: 'chat',
    content: '',
  });

  for (let i = 0; i < extracted.messages.length; i += 1) {
    const m = extracted.messages[i];
    const isSelf = m.side === 'right' || isSelfSpeaker(m.speaker);
    appendMessage(event.id, {
      type: 'msg',
      side: m.side,
      personId: isSelf ? (selfPersonId ?? null) : personForSpeaker(m.speaker, cache),
      body: bodies[i],
    });
  }

  return {
    eventId: event.id,
    title: event.title,
    messageCount: extracted.messages.length,
    imageCount,
    preview,
    warnings,
  };
}
