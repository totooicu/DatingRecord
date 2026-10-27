// 映射文件：库里只存一个链接，正文引用和实体文件一模一样（file:<storedId>）。
//
// 为什么要有它：手机里很多素材本来就在网盘 / 图床 / 局域网目录上，
// 全部下载进 IndexedDB 既占空间又要来回同步。映射只落一条元数据，
// 渲染时 urlForFile() 直接把源链接交给 <img src> / <a href>。
//
// 与实体文件的差别只在「二进制放哪儿」：
//   · 映射：source_url 非空，IndexedDB 里没有 blob，引用名按**链接** hash 生成（link-…）
//   · 实体：正常上传，引用名按**内容** hash 生成（sha-…）
// 想从链接变成实体，走「保存为实体文件」：下载后交给正常上传流程。

import { insertMappedFile, listFiles, nameSlots, type StoredFile } from '../repo/files';
import { extFor, linkStem, pickStoredId, sha256Text } from './naming';

/** 浏览器自己能打开、能探测能下载的协议 */
const WEB_SCHEMES = ['http:', 'https:', 'ftp:', 'ftps:', 'file:', 'content:', 'data:', 'blob:'];

/** 会被浏览器当脚本执行的协议：任何情况下都不收 */
const BLOCKED_SCHEMES = ['javascript:', 'vbscript:'];

/** 取链接的协议（小写、带冒号）；不是 `scheme:` 开头就返回空串 */
export function schemeOf(raw: string): string {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw.trim());
  return m ? `${m[1].toLowerCase()}:` : '';
}

/**
 * App 深链：`qqmusic://…`、`weixin://…`、`spotify:track:…` 这类。
 *
 * 它们只能交给手机上的 App 打开，浏览器既 fetch 不了也下载不了，
 * 所以库里只保存链接（映射文件），点开时原样交给 `<a href>`。
 */
export function isAppLink(raw: string): boolean {
  const s = schemeOf(raw);
  return !!s && !WEB_SCHEMES.includes(s) && !BLOCKED_SCHEMES.includes(s);
}

/** 会被浏览器当脚本执行的协议：面板上直接判死，不等到保存才报错 */
export function isScriptLink(raw: string): boolean {
  return BLOCKED_SCHEMES.includes(schemeOf(raw));
}

/**
 * 把用户填的内容规整成能存进库的链接。
 *
 * 手机文件路径常常写成 `/storage/emulated/0/...`，没有 scheme → 补 file://；
 * 纯域名 → 补 https://。规整只做这一层，不做可用性判断（那是测试连接的事）。
 *
 * 自定义 scheme 原样保留：App 深链是合法链接，只是浏览器打不开——
 * 真正危险的是 `javascript:` / `vbscript:` 这种会被当脚本执行的协议，直接拒绝。
 */
export function normalizeLink(raw: string): string {
  const s = raw.trim();
  if (!s) throw new Error('链接不能为空');
  if (s.startsWith('/')) return `file://${s}`;
  const scheme = schemeOf(s);
  if (scheme) {
    if (BLOCKED_SCHEMES.includes(scheme)) throw new Error(`不支持的协议：${scheme}（会被浏览器当脚本执行）`);
    try {
      new URL(s);
    } catch {
      throw new Error('链接格式不正确');
    }
    return s;
  }
  // 没有协议：当成域名/相对地址补 https
  return `https://${s}`;
}

/**
 * 从链接里猜文件名：取路径最后一段（去掉 query / hash）。
 * App 深链常常没有路径（`qqmusic://i.qq.com/` 或 `spotify:track:xxx`），
 * 这时退到域名 / 协议名，总比空着要用户手写强。
 */
export function fileNameFromLink(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop() ?? '';
    const name = decodeURIComponent(seg);
    if (name) return name;
    return u.host || `${u.protocol.replace(':', '')} 链接`;
  } catch {
    return '';
  }
}

/** 从 Content-Disposition 里取文件名（filename* 优先，兼容中文） */
export function fileNameFromDisposition(v: string | null): string {
  if (!v) return '';
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(v);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* 落到下面的普通 filename */
    }
  }
  const plain = /filename\s*=\s*("?)([^";]+)\1/.exec(v);
  return plain ? plain[2].trim() : '';
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
};

/** 文件名 → mime；远端给了 content-type 时以远端为准 */
export function guessMime(name: string, header?: string): string {
  const h = (header ?? '').split(';')[0].trim().toLowerCase();
  if (h && h !== 'application/octet-stream' && h !== 'binary/octet-stream') return h;
  const ext = extFor(name, '').toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export interface LinkProbe {
  ok: boolean;
  status: number;
  mime: string;
  /** 远端大小：读不到（跨域没暴露 Content-Length、HEAD 不支持）时为 0 */
  size: number;
  /** 远端给的文件名（Content-Disposition 优先） */
  fileName: string;
  finalUrl: string;
  /** 失败原因（给用户看的一句话） */
  error?: string;
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return { signal: ctl.signal, done: () => clearTimeout(t) };
}

function describeError(e: unknown, reason?: unknown): string {
  if (reason === 'cancelled') return '已取消下载';
  if (reason === 'timeout') return '下载超时';
  if (e instanceof DOMException && e.name === 'AbortError') return '连接超时';
  if (e instanceof TypeError) return '连接失败（链接打不开，或对方不允许跨域访问）';
  return e instanceof Error ? e.message : '连接失败';
}

/**
 * 测试连接：先 HEAD，HEAD 被拒再退回只取 1 字节的 GET。
 *
 * 跨域时浏览器只暴露少数几个响应头，但 Content-Type / Content-Length 正好在
 * CORS 安全列表里，所以拿到 200 就能把类型和大小读出来。
 */
export async function probeLink(url: string, timeoutMs = 15000): Promise<LinkProbe> {
  const target = normalizeLink(url);
  // App 深链没有 HTTP 响应：直说能怎么用，别让 fetch 报一句「连接失败」
  if (isAppLink(target)) {
    return {
      ok: false,
      status: 0,
      mime: '',
      size: 0,
      fileName: fileNameFromLink(target),
      finalUrl: target,
      error: `应用链接（${schemeOf(target)}）只能交给手机上的 App 打开，探测不了；直接「保存为映射」即可`,
    };
  }
  const t = withTimeout(timeoutMs);
  try {
    let res = await fetch(target, { method: 'HEAD', signal: t.signal });
    if (!res.ok) {
      res = await fetch(target, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: t.signal,
      });
    }
    const len = Number(res.headers.get('content-length') ?? '');
    const fileName =
      fileNameFromDisposition(res.headers.get('content-disposition')) || fileNameFromLink(res.url || target);
    return {
      ok: res.ok || res.status === 206,
      status: res.status,
      mime: (res.headers.get('content-type') ?? '').split(';')[0].trim(),
      size: Number.isFinite(len) && len > 0 ? len : 0,
      fileName,
      finalUrl: res.url || target,
    };
  } catch (e) {
    return { ok: false, status: 0, mime: '', size: 0, fileName: '', finalUrl: target, error: describeError(e) };
  } finally {
    t.done();
  }
}

export interface DownloadedLink {
  blob: Blob;
  mime: string;
  /** 远端给的文件名，可能为空 */
  fileName: string;
  finalUrl: string;
}

export interface DownloadOptions {
  /** 外部取消信号：用户点「取消下载」或关掉弹窗时传进来 */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 流式读取进度：total 为 0 表示远端没给 Content-Length */
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * 下载链接内容（保存为实体 / hash 实体文件用）。
 * 走流式读取：大文件能显示已下载多少，也能被 signal 立刻掐断。
 */
export async function downloadLink(url: string, opts: DownloadOptions = {}): Promise<DownloadedLink> {
  const target = normalizeLink(url);
  if (isAppLink(target)) throw new Error(`应用链接（${schemeOf(target)}）不能下载，只能保存为映射`);
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort('timeout'), opts.timeoutMs ?? 60000);
  const onCancel = () => ctl.abort('cancelled');
  if (opts.signal) {
    if (opts.signal.aborted) ctl.abort('cancelled');
    else opts.signal.addEventListener('abort', onCancel, { once: true });
  }
  try {
    const res = await fetch(target, { signal: ctl.signal });
    if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    const fileName =
      fileNameFromDisposition(res.headers.get('content-disposition')) || fileNameFromLink(res.url || target);
    const total = Number(res.headers.get('content-length') ?? '') || 0;
    let blob: Blob;
    if (res.body && opts.onProgress) {
      const reader = res.body.getReader();
      const chunks: BlobPart[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.length;
          opts.onProgress(loaded, total);
        }
      }
      blob = new Blob(chunks, { type: mime });
    } else {
      blob = await res.blob();
    }
    return { blob, mime, fileName, finalUrl: res.url || target };
  } catch (e) {
    throw new Error(describeError(e, ctl.signal.reason));
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onCancel);
  }
}

/** 链接的引用名（不含唯一化后缀）：link-<hash> + 扩展名 */
export async function linkStoredId(link: string, name: string, mime: string): Promise<string> {
  const sha = await sha256Text(link);
  const ext = extFor(name, mime);
  // 非安全上下文没有 crypto.subtle：退回随机名，功能不退化（和上传那边同一思路）
  if (!sha) return `link-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${ext}`;
  return `${linkStem(sha)}${ext}`;
}

export interface SaveMappingInput {
  url: string;
  name: string;
  mime: string;
  size?: number;
  sha256?: string;
}

/**
 * 保存为映射：同一链接重复保存时复用已有行（不新建、不占空间）。
 * 引用名冲突（同 hash 不同名）时按 pickStoredId 顺延序号。
 */
export async function saveAsMapping(input: SaveMappingInput): Promise<{ file: StoredFile; reused: boolean }> {
  const target = normalizeLink(input.url);
  const name = input.name.trim();
  if (!name) throw new Error('请填写文件名');
  const mime = input.mime || guessMime(name);

  const existed = findMappingByUrl(target);
  if (existed) return { file: existed, reused: true };

  const full = await linkStoredId(target, name, mime);
  const ext = extFor(name, mime);
  const base = ext && full.endsWith(ext) ? full.slice(0, -ext.length) : full;
  const storedId = pickStoredId(base, ext, nameSlots());
  const file = insertMappedFile({
    name,
    sourceUrl: target,
    storedId,
    mime,
    size: input.size ?? 0,
    sha256: input.sha256 ?? '',
  });
  return { file, reused: false };
}

/** 已有同一链接的映射行？没有返回 null */
export function findMappingByUrl(url: string): StoredFile | null {
  return listFiles().find((f) => f.sourceUrl === url) ?? null;
}
