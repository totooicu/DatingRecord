// 坚果云 WebDAV 客户端（只实现同步用得到的动词）。
//
// 为什么是 WebDAV：坚果云没有公开的对象存储 SDK，WebDAV 是它唯一稳定的
// 文件级接口，支持 MKCOL/PROPFIND/PUT/GET/DELETE，够做内容寻址分片。
//
// 两个必须知道的点：
// 1. 认证只有 HTTP Basic：用户名是坚果云注册邮箱，密码是「应用密码」（不是登录密码）。
// 2. 坚果云的 WebDAV 不返回 CORS 头，浏览器直连会被拦。
//    所以 `base` 允许改成自建反代地址；直连时保持默认的 dav.jianguoyun.com。

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

async function request(
  c: DavConfig,
  method: string,
  path: string,
  body?: BodyInit | null,
  headers: Record<string, string> = {},
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(davUrl(c, path), {
      method,
      headers: { Authorization: authHeader(c), ...headers },
      body: body ?? null,
    });
  } catch {
    // fetch 只在网络层失败时抛 TypeError（DNS / 断网 / 被跨域拦），401 不会走到这里。
    // 注意：硅基流动等 AI 服务商主动返回 CORS 头所以浏览器放行；坚果云 WebDAV 默认不返回，
    // 浏览器在发送前就拦截，表现为同一个 TypeError。详见设置里「高级 → 服务地址」。
    throw new DavError(
      '连不上坚果云：网络不通，或浏览器拦了跨域请求（坚果云 WebDAV 默认不返回 CORS 头）。可在「高级 → 服务地址」填一个转发到 dav.jianguoyun.com 的反向代理。',
      0,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new DavError('账号或应用密码不对（密码要用坚果云「应用密码」，不是登录密码）', res.status);
  }
  if (res.status === 507) {
    throw new DavError('坚果云空间不足', 507);
  }
  return res;
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
  const res = await request(c, 'PUT', path, new Blob([text], { type: 'application/json;charset=utf-8' }), {
    'Content-Type': 'application/json;charset=utf-8',
  });
  if (!res.ok) throw new DavError(`上传失败（${res.status}）`, res.status);
}

export async function putBinary(c: DavConfig, path: string, bytes: Uint8Array): Promise<void> {
  // 复制到独立 ArrayBuffer：subarray 的底层 buffer 更大，直接交给 Blob 会带上错位的偏移
  const res = await request(c, 'PUT', path, new Blob([bytes.slice()], { type: 'application/octet-stream' }), {
    'Content-Type': 'application/octet-stream',
  });
  if (!res.ok) throw new DavError(`上传分片失败（${res.status}）`, res.status);
}

/** 读文本；不存在返回 null（首次同步的常态，不该当异常） */
export async function getText(c: DavConfig, path: string): Promise<string | null> {
  const res = await request(c, 'GET', path);
  if (res.status === 404) return null;
  if (!res.ok) throw new DavError(`读取失败（${res.status}）`, res.status);
  return res.text();
}

export async function getBinary(c: DavConfig, path: string): Promise<Uint8Array | null> {
  const res = await request(c, 'GET', path);
  if (res.status === 404) return null;
  if (!res.ok) throw new DavError(`读取分片失败（${res.status}）`, res.status);
  return new Uint8Array(await res.arrayBuffer());
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
  if (!res.ok) throw new DavError(`列目录失败（${res.status}）`, res.status);

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
