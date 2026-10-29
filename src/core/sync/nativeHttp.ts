// 壳的网络代理（桥的 net.*）在这一层的用法：WebDAV 请求交给原生发。
//
// 为什么需要它：坚果云的 WebDAV 不返回跨域头，浏览器 fetch 一定被拦，
// 而且 PROPFIND / MKCOL 是非标准动词，预检也过不去。壳在系统网络栈上发请求
// 不受 CORS 约束，于是「发一次 HTTP」这件事交给壳，本层只搬数据、不做同步判断。
// 契约（参数、上限、错误语义）在壳仓库 docs/ADAPTATION_GUIDE.md §4.5。
//
// 探测的规矩跟项目里其它原生能力一样：**发一次 action 看有没有人回**，不读 UA、
// 不看注入标记。结果是「一次页面加载内缓存」——浏览器里没人回，每条请求都问一遍
// 会白等 3 秒，同步几十个分片更不能问几十次。

import { base64ToBytes, bytesToBase64, invoke } from '../compat/bridge';

export interface NativeCaps {
  /** 壳愿意代发的 HTTP 动词 */
  methods: Record<string, boolean>;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxTimeoutMs: number;
  version: string;
}

export interface NativeRequestInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  /** 请求体：文本按 UTF-8 编，二进制原样编，两者到壳那边都是 base64 */
  body?: Uint8Array | string | null;
  timeoutMs?: number;
}

export interface NativeResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

let capsProbe: Promise<NativeCaps | null> | null = null;

/** 壳的 net.* 能力；没有壳（普通浏览器、或壳太旧）时返回 null。 */
export function nativeCaps(): Promise<NativeCaps | null> {
  if (!capsProbe) {
    capsProbe = invoke('net.capabilities', {}, 3000)
      .then((r) => {
        const methods = (r.methods ?? {}) as Record<string, boolean>;
        return {
          methods,
          maxRequestBytes: Number(r.maxRequestBytes ?? 0),
          maxResponseBytes: Number(r.maxResponseBytes ?? 0),
          maxTimeoutMs: Number(r.maxTimeoutMs ?? 0),
          version: String(r.version ?? ''),
        } satisfies NativeCaps;
      })
      .catch(() => null);
  }
  return capsProbe;
}

/** 当前这一页实际会走哪条通道；version 是壳的 versionName，浏览器路径下为空 */
export interface DavChannel {
  native: boolean;
  version: string;
}

/** 设置页要说清「现在是谁在发请求」，否则用户分不清要不要装壳或配反代。 */
export async function currentChannel(): Promise<DavChannel> {
  const caps = await nativeCaps();
  const native = !!caps && caps.methods.PROPFIND === true && caps.methods.MKCOL === true;
  return { native, version: caps?.version ?? '' };
}

/** 这条通道能不能用：要求壳明确支持 PROPFIND，光有 net.capabilities 回应不算。 */
export async function nativeSupported(): Promise<boolean> {
  return (await currentChannel()).native;
}

/**
 * 让壳发一次请求。
 *
 * 壳那边出错（超时、DNS、TLS、地址不合法）时 `invoke` 直接 reject，
 * 错误串已经是给用户看的话，这里不再翻译一遍，原样往上抛。
 */
export async function nativeRequest(input: NativeRequestInput): Promise<NativeResponse> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const params: Record<string, unknown> = { method: input.method, url: input.url };
  if (input.headers && Object.keys(input.headers).length > 0) params.headers = input.headers;
  if (input.body != null && input.body !== '') {
    params.bodyBase64 =
      typeof input.body === 'string' ? bytesToBase64(new TextEncoder().encode(input.body)) : bytesToBase64(input.body);
  }
  params.timeoutMs = timeoutMs;
  // 网页侧多等 5 秒：壳先超时，错误串才有意义（两边都超时就看谁先报）
  const r = await invoke('net.request', params, timeoutMs + 5000);
  const raw = r.headers;
  const headers: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) headers[k] = String(v);
  }
  return {
    status: Number(r.status ?? 0),
    statusText: String(r.statusText ?? ''),
    headers,
    body: base64ToBytes(String(r.bodyBase64 ?? '')),
  };
}
