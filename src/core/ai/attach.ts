// 给对话准备「附件」：把用户挑的文件变成模型能读的东西。
//
// 三条路，按文件类型分：
//   · 文本类（txt/md/json/csv/代码…）→ 读出纯文本，原样贴进消息
//   · 图片 → data URL（base64），走模型的视觉能力
//   · 其他（pdf/zip/音视频）→ 只给元信息。**不假装能读**：
//     这些格式要么解析不了，要么会撑爆上下文，直说比给模型一堆乱码强。
//
// 附件不写进本库：它的生命周期就是这一条消息。要长期留存的文件走「从文件库」
// 那条入口（文件本来就已经入库了，这里只是把它读出来）。
import { getBlob } from '../db/blob';
import type { StoredFile } from '../repo/files';

/** 一次最多带几个附件：再多上下文就装不下了 */
export const MAX_ATTACHMENTS = 4;
/** 单个文本附件读多少字，超出部分截断并注明 */
export const MAX_TEXT_CHARS = 20000;
/** 单个图片上限（base64 之后体积会涨约 1/3） */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type AttachmentKind = 'text' | 'image' | 'unsupported';

export interface Attachment {
  /** 界面列表用的稳定 key */
  key: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  /** 文本内容（kind === 'text'） */
  text?: string;
  /** data URL（kind === 'image'） */
  dataUrl?: string;
  /** 读不出来 / 读不全的原因，界面上照实显示 */
  warning?: string;
}

const TEXT_EXT = new Set([
  'txt', 'text', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'yml', 'yaml',
  'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs',
  'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'sql',
  'ini', 'conf', 'toml', 'srt', 'vtt',
]);

function extOfName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** 判断一个文件该走哪条路；mime 为空时靠扩展名兜底 */
export function kindOf(name: string, mime: string): AttachmentKind {
  const ext = extOfName(name);
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
    return 'image';
  }
  // 注意 text/* 要放在下面之前判断，但 svg 是文本也是图片——按图片走更符合直觉
  if (mime.startsWith('text/') || TEXT_EXT.has(ext)) return 'text';
  if (mime === 'application/json' || mime === 'application/xml') return 'text';
  return 'unsupported';
}

function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ''));
    fr.onerror = () => reject(fr.error ?? new Error('读取失败'));
    fr.readAsText(blob);
  });
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ''));
    fr.onerror = () => reject(fr.error ?? new Error('读取失败'));
    fr.readAsDataURL(blob);
  });
}

/** 把一个 Blob 变成附件；读不了也返回对象，用 warning 说明原因，不抛错打断整批 */
export async function toAttachment(blob: Blob, name: string, key: string): Promise<Attachment> {
  const mime = blob.type || '';
  const kind = kindOf(name || '未命名', mime);
  const base = { key, name: name || '未命名', mime, size: blob.size, kind };

  if (kind === 'unsupported') {
    return { ...base, warning: '这种格式读不了内容，只能告诉模型有这么一个文件' };
  }

  if (kind === 'image') {
    if (blob.size > MAX_IMAGE_BYTES) {
      return { ...base, warning: `图片超过 ${fmtSize(MAX_IMAGE_BYTES)}，太大没有发送` };
    }
    try {
      return { ...base, dataUrl: await readDataUrl(blob) };
    } catch {
      return { ...base, warning: '图片读取失败' };
    }
  }

  try {
    const raw = await readText(blob);
    if (raw.length > MAX_TEXT_CHARS) {
      return { ...base, text: raw.slice(0, MAX_TEXT_CHARS), warning: `内容过长，只读了前 ${MAX_TEXT_CHARS} 字` };
    }
    return { ...base, text: raw };
  } catch {
    return { ...base, warning: '文本读取失败' };
  }
}

/** 从本地文件（input 选中的 / 拖进来的）生成附件 */
export async function fromFile(file: File, key: string): Promise<Attachment> {
  return toAttachment(file, file.name, key);
}

/** 从文件库挑一个已有文件：读它的 blob 再走同一套流程 */
export async function fromStored(f: StoredFile, key: string): Promise<Attachment> {
  const blob = await getBlob(f.id);
  if (!blob) {
    return { key, name: f.name, mime: f.mime, size: f.size, kind: 'unsupported', warning: '库里没有这个文件的内容' };
  }
  return toAttachment(blob, f.name, key);
}

/**
 * 把附件拼成给模型看的一段文本。
 *
 * 文本附件直接贴正文；图片用 OpenAI 的多模态分段（image_url）——
 * 这一步发生在把 AgentMessage 转成请求体的时候，所以这里只返回文本部分，
 * 图片交给 imagesOf()。
 */
export function attachText(atts: Attachment[]): string {
  if (atts.length === 0) return '';
  const parts: string[] = [];
  for (const a of atts) {
    if (a.kind === 'text' && a.text !== undefined) {
      parts.push(`【文件：${a.name}】\n${a.text}\n【文件结束：${a.name}】`);
    } else if (a.kind === 'image') {
      parts.push(`【图片：${a.name}】`);
    } else {
      parts.push(`【文件：${a.name}（${a.mime || '未知格式'}，${fmtSize(a.size)}）——内容无法读取】`);
    }
  }
  return parts.join('\n\n');
}

/** 这条消息要带哪些图片（走视觉能力） */
export function imagesOf(atts: Attachment[]): { name: string; dataUrl: string }[] {
  return atts
    .filter((a) => a.kind === 'image' && a.dataUrl)
    .map((a) => ({ name: a.name, dataUrl: a.dataUrl! }));
}

/** 界面上的附件摘要：几个文件、有没有读不了的 */
export function summaryOf(atts: Attachment[]): string {
  if (atts.length === 0) return '';
  const bad = atts.filter((a) => a.warning).length;
  const head = `${atts.length} 个附件`;
  return bad ? `${head}（${bad} 个有问题）` : head;
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
