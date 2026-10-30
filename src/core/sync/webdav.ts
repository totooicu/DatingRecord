// 坚果云 WebDAV 客户端（只实现同步用得到的动词）。
//
// 为什么是 WebDAV：坚果云没有公开的对象存储 SDK，WebDAV 是它唯一稳定的
// 文件级接口，支持 MKCOL/PROPFIND/PUT/GET/DELETE，够做内容寻址分片。
//
// 认证只有 HTTP Basic：用户名是坚果云注册邮箱，密码是「应用密码」（不是登录密码）。
//
// **两条传输通道**（同一套动词，差别只在请求怎么发出去）：
//   1. 壳代理 net.*：壳在系统网络栈上发请求，不受 CORS 约束——坚果云不返回跨域头，
//      这条路才是能用的一条，PROPFIND/MKCOL 这些非标准动词也只有原生发得出去。
//   2. 浏览器直连 fetch：只有在服务端自己返回跨域头时才通，所以留了「服务地址」
//      可以填自建反代。没装壳的人在浏览器里仍能用反代同步。
// 通道由第一次使用时探测 `net.capabilities` 决定（发一次 action 试，不读环境猜），
// 探测结果一次页面加载内缓存，不会每个请求都问一遍壳。

import { nativeRequest, nativeSupported } from './nativeHttp';

export const DEFAULT_DAV_BASE = 'https://dav.jianguoyun.com/dav';

export interface DavConfig {
  /** 服务地址，不带结尾斜杠 */
  base: string;
  user: string;
  password: string;
  /** 远端根目录（应用自己的子目录），如 DatingRecord */
  folder: string;
}

export class DavError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DavError';
  }
}

/** 传输层返回的最小响应形状：浏览器 Response 与壳的 net.request 应答都能套进来 */
export interface DavResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  bytes(): Promise<Uint8Array>;
}

/** 请求体：文本或二进制；不给即无请求体 */
type DavBody = Uint8Array | string | null | undefined;

function base64Utf8(text: string): string {
  // 中文账号/密码要先转 UTF-8 字节再 base64——btoa 直接喂非 ASCII 会抛
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function authHeader(c: DavConfig): string {
  return `Basic ${base64Utf8(`${c.user}:${c.password}`)}`;
}

/** 拼接远端 URL，逐段 encode（文件名/目录名里可能有中文） */
export function davUrl(c: DavConfig, path = ''): string {
  const segs = [c.folder, ...path.split('/').filter(Boolean)].map((s) => encodeURIComponent(s));
  return `${c.base.replace(/\/+$/, '')}/${segs.join('/')}`;
}

function wrapFetch(res: Response): DavResponse {
  return {
    status: res.status,
    ok: res.ok,
    text: () => res.text(),
    bytes: async () => new Uint8Array(await res.arrayBuffer()),
  };
}

/**
 * 交给 fetch 的请求体：文本原样，二进制先复制成独立的 ArrayBuffer。
 * subarray 出来的视图底层 buffer 更大，直接给 fetch 会带上错位的偏移。
 */
function fetchBody(body: DavBody): BodyInit | null {
  if (body == null || body === '') return null;
  if (typeof body === 'string') return body;
  return (body.slice() as Uint8Array).buffer as ArrayBuffer;
}

/** 一次请求：优先走壳的 net.*，没有壳再退回浏览器 fetch。 */
async function request(
  c: DavConfig,
  method: string,
  path: string,
  body?: DavBody,
  headers: Record<string, string> = {},
): Promise<DavResponse> {
  const url = davUrl(c, path);
  const auth = { Authorization: authHeader(c), ...headers };
  // 分片只有 64KB，但一次同步要连着发几十条；手机上 30s 比默认 15s 稳
  const timeoutMs = 30_000;

  if (await nativeSupported()) {
    const res = await nativeRequest({ method, url, headers: auth, body: body ?? null, timeoutMs });
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      text: async () => new TextDecoder().decode(res.body),
      bytes: async () => res.body,
    };
  }

  let res: Response;
  try {
    res = await fetch(url, { method, headers: auth, body: fetchBody(body) });
  } catch {
    // fetch 只在网络层失败时抛 TypeError（DNS / 断网 / 被跨域拦），401 不会走到这里。
    // 注意：硅基流动等 AI 服务商主动返回 CORS 头所以浏览器放行；坚果云 WebDAV 默认不返回，
    // 浏览器在发送前就拦截，表现为同一个 TypeError。
    throw new DavError(
      '连不上坚果云：网络不通，或浏览器拦了跨域请求（坚果云 WebDAV 不返回 CORS 头，非标准的 PROPFIND / MKCOL 更是发不出去）。'
        + '两条出路：装带网络代理的壳（壳里直连 dav.jianguoyun.com，无需反代），或在「高级 → 服务地址」填一个转发到它的反向代理。',
      0,
    );
  }
  return wrapFetch(res);
}

/** 状态码到用户可见错误的统一翻译，两条通道共用 */
function assertUsable(res: DavResponse, what: string): void {
  if (res.status === 401 || res.status === 403) {
    throw new DavError('账号或应用密码不对（密码要用坚果云「应用密码」，不是登录密码）', res.status);
  }
  if (res.status === 507) {
    throw new DavError('坚果云空间不足', 507);
  }
  if (res.status === 409) {
    // 409 基本只有一个意思：往不存在的目录里放文件（RFC 4918，坚果云照做）。
    // 光报数字用户无从下手，写成一句人才知道「是这一级目录没建起来」，不是账号问题。
    throw new DavError(`${what}失败（409：上一级目录还没建好，先建目录再传）`, 409);
  }
  if (!res.ok) {
    throw new DavError(`${what}失败（${res.status}）`, res.status);
  }
}

/** 建目录；已存在时坚果云返回 405，视为成功 */
export async function mkcol(c: DavConfig, path: string): Promise<void> {
  const res = await request(c, 'MKCOL', path);
  if (!res.ok && res.status !== 405) throw new DavError(`建目录失败（${res.status}）`, res.status);
}

/**
 * 逐级建目录，已存在的层级跳过。
 * 注意：base 已经把 folder 拼在 URL 里，所以根目录用 '' 表示，
 * 并且要把 folder 当成第 0 级来建，不能给 root 包一层（会变成 folder/folder）。
 */
export async function ensureDir(c: DavConfig, path: string): Promise<void> {
  await mkcol(c, '');
  const segs = path.split('/').filter(Boolean);
  for (let i = 1; i <= segs.length; i += 1) await mkcol(c, segs.slice(0, i).join('/'));
}

export async function putText(c: DavConfig, path: string, text: string): Promise<void> {
  const res = await request(c, 'PUT', path, text, {
    'Content-Type': 'application/json;charset=utf-8',
  });
  assertUsable(res, '上传');
}

export async function putBinary(c: DavConfig, path: string, bytes: Uint8Array): Promise<void> {
  // 传视图即可：浏览器路径由 fetchBody 复制成独立 ArrayBuffer，走桥的路径按视图逐段编码，不会串位
  const res = await request(c, 'PUT', path, bytes, {
    'Content-Type': 'application/octet-stream',
  });
  assertUsable(res, '上传分片');
}

/** 读文本；不存在返回 null（首次同步的常态，不该当异常） */
export async function getText(c: DavConfig, path: string): Promise<string | null> {
  const res = await request(c, 'GET', path);
  if (res.status === 404) return null;
  assertUsable(res, '读取');
  return res.text();
}

export async function getBinary(c: DavConfig, path: string): Promise<Uint8Array | null> {
  const res = await request(c, 'GET', path);
  if (res.status === 404) return null;
  assertUsable(res, '读取分片');
  return res.bytes();
}

export async function remove(c: DavConfig, path: string): Promise<void> {
  const res = await request(c, 'DELETE', path);
  if (!res.ok && res.status !== 404) throw new DavError(`删除失败（${res.status}）`, res.status);
}

export interface DavEntry {
  name: string;
  isDir: boolean;
  size: number;
}

/**
 * 列目录（Depth: 1）。
 * 只为取名字和大小，用正则拆 multistatus 就够——引个 XML 库不值当。
 */
export async function list(c: DavConfig, path = ''): Promise<DavEntry[]> {
  const body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>';
  const res = await request(c, 'PROPFIND', path, body, {
    Depth: '1',
    'Content-Type': 'application/xml;charset=utf-8',
  });
  if (res.status === 404) return [];
  assertUsable(res, '列目录');

  const xml = await res.text();
  const out: DavEntry[] = [];
  for (const block of xml.match(/<d:response>[\s\S]*?<\/d:response>/g) ?? []) {
    const href = /<d:href>([^<]*)<\/d:href>/.exec(block)?.[1] ?? '';
    const segs = href.replace(/\/+$/, '').split('/');
    const name = decodeURIComponent(segs.pop() ?? '');
    if (!name) continue; // 目录自身
    out.push({
      name,
      isDir: /<d:collection\s*\/>/.test(block),
      size: Number(/<d:getcontentlength>(\d+)</.exec(block)?.[1] ?? 0),
    });
  }
  return out;
}

/** 测试连接：能把应用目录建出来、能列出来，就算通 */
export async function testConnection(c: DavConfig): Promise<void> {
  await ensureDir(c, '');
  await list(c, '');
}
