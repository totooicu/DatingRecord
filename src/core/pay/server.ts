// 收费服务器的客户端：怎么找到它、怎么调它、调用失败怎么说人话。
//
// 找地址的顺序（docs/PAY_MOCK.md 第 3 节）：
//   1. 设置里手填的地址（`dr.pay.base`）——浏览器里跑回归就靠它；
//   2. 壳端局域网服务在跑 → http://127.0.0.1:<端口>。/__pay/* 就挂在壳那台
//      DataShareServer 上，和 /__remote/* 同一个端口，所以**不用新加一条桥**，
//      直接复用 remote.status 探到的端口。
//   两个都没有 → 返回 null，UI 显示「没有可用收费服务器」并把手填框摆出来。

import { shellRelayStatus } from '../remote/shellRelay';
import type { PayChannelKind, PayService, ServerOrder } from './types';

const BASE_KEY = 'dr.pay.base';
/** 手填一次就记住（这是设备级偏好，不进库——换手机也不该把收费地址带过去） */
export function getManualBase(): string {
  try {
    return localStorage.getItem(BASE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setManualBase(v: string): void {
  try {
    const t = v.trim().replace(/\/+$/, '');
    if (t) localStorage.setItem(BASE_KEY, t);
    else localStorage.removeItem(BASE_KEY);
  } catch {
    /* 隐私模式下写不进 localStorage：本次会话用内存值，别把页面搞崩 */
  }
}

/** 只收 http(s)，避免有人把 javascript: 或相对路径填进来 */
export function normalizeBase(v: string): string | null {
  const t = v.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

export type PayBaseSource = 'manual' | 'shell';

export interface PayBase {
  url: string;
  from: PayBaseSource;
}

/** 当前该往哪台服务器要钱；探不到返回 null（不抛，页面按「没服务器」画） */
export async function resolvePayBase(timeoutMs = 1500): Promise<PayBase | null> {
  const manual = normalizeBase(getManualBase());
  if (manual) return { url: manual, from: 'manual' };
  const st = await shellRelayStatus(timeoutMs);
  if (st && st.running && st.port > 0) {
    // 壳里页面本身就是壳那台服务器代理出来的，走回环最稳（跨网段时也能通）
    return { url: `http://127.0.0.1:${st.port}`, from: 'shell' };
  }
  return null;
}

export type PayErrorKind = 'offline' | 'timeout' | 'http' | 'badjson' | 'api';

/** 调用失败：message 直接能进 toast，kind 给 UI 分派（offline 要提示去填地址） */
export class PayError extends Error {
  kind: PayErrorKind;
  code?: string;
  constructor(kind: PayErrorKind, message: string, code?: string) {
    super(message);
    this.kind = kind;
    this.code = code;
  }
}

async function call<T>(
  base: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, signal: ac.signal });
  } catch (e) {
    clearTimeout(timer);
    const msg = String((e as Error)?.name === 'AbortError' ? '' : (e as Error)?.message ?? e);
    if (ac.signal.aborted) throw new PayError('timeout', `收费服务器没响应（${timeoutMs / 1000} 秒）`);
    throw new PayError('offline', `连不上收费服务器${msg ? `：${msg.slice(0, 80)}` : ''}`);
  }
  clearTimeout(timer);
  let body: unknown = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new PayError('badjson', `收费服务器回的不是 JSON（HTTP ${res.status}）`);
    }
  }
  if (!res.ok) {
    const code = (body as { error?: string } | null)?.error;
    throw new PayError('api', payErrorText(res.status, code), code);
  }
  if (!body) throw new PayError('badjson', '收费服务器回了空响应');
  return body as T;
}

/** 服务器返回的 error 码翻成人话；未知码原样带出来，方便对着协议查 */
function payErrorText(status: number, code?: string): string {
  if (code === 'order_not_found') return '这张单子在服务器上不存在（可能被清空了）';
  if (code === 'bad_transition') return '这张单子已经结清，状态不能再改';
  if (code === 'expired') return '订单已过期，重新下单';
  if (code === 'bad_request') return '下单参数不对（服务或金额没被服务器接受）';
  return `服务器返回 HTTP ${status}${code ? `（${code}）` : ''}`;
}

/** 下单。returnUrl 用当前页面地址：收银台付完跳回来，页面靠 ?orderId= 那条路查单收敛 */
export async function createOrder(
  base: string,
  svc: Pick<PayService, 'id' | 'title' | 'amountCents'>,
  channel?: PayChannelKind,
  timeoutMs = 8000,
): Promise<ServerOrder> {
  const returnUrl = typeof location === 'undefined' ? '' : location.href.split('#')[0];
  return call<ServerOrder>(base, '/__pay/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service: svc, returnUrl, channel }),
  }, timeoutMs);
}

export async function queryOrder(base: string, orderId: string, timeoutMs = 6000): Promise<ServerOrder> {
  return call<ServerOrder>(base, `/__pay/order?id=${encodeURIComponent(orderId)}`, { method: 'GET' }, timeoutMs);
}

/** 手动驱动一张单（测试线才有 action；接真商户号时这颗只该存在于壳的测试页） */
export async function driveOrder(
  base: string,
  orderId: string,
  action: 'pay' | 'fail' | 'cancel' | 'expire' | 'refund',
  channel?: PayChannelKind,
): Promise<ServerOrder> {
  const q = new URLSearchParams({ id: orderId, action });
  if (channel) q.set('channel', channel);
  return call<ServerOrder>(base, `/__pay/order?${q.toString()}`, { method: 'POST' }, 6000);
}

/** 模拟异步回调。times>1 专门用来打幂等 */
export async function notifyOrder(base: string, orderId: string, times = 1): Promise<{ ok: boolean; orderId: string; status: string; delivered: number }> {
  return call(base, `/__pay/notify?id=${encodeURIComponent(orderId)}&times=${times}`, { method: 'POST' }, 6000);
}

export async function listOrders(base: string): Promise<ServerOrder[]> {
  const r = await call<{ orders: ServerOrder[] }>(base, '/__pay/orders', { method: 'GET' }, 6000);
  return Array.isArray(r.orders) ? r.orders : [];
}

/** 相对路径补成绝对地址（服务器给的 webUrl 是 /__pay/cashier?... 这种） */
export function absUrl(base: string, u: string): string {
  if (/^[a-z]+:\/\//i.test(u)) return u;
  return base + (u.startsWith('/') ? u : `/${u}`);
}
