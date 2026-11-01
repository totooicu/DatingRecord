// 一次性服务的用例层：页面只调这几个函数，服务器地址、状态落库、幂等都在下面兜掉。
//
// 三条路会把同一张单的状态打进来，全都收敛到 refreshOrder / applyServerOrder：
//   · 用户在收银台（或支付宝/微信 app）付完退回来 → 地址栏带 ?orderId=&status= → syncFromReturnUrl()
//   · 用户点「查单」
//   · 服务器推异步通知 → notifyAndSync()
// 「到账」这件事只有一个入口，就不会出现两条购买记录。

import { showToast } from '../../ui/toast';
import {
  absUrl,
  createOrder,
  driveOrder,
  PayError,
  queryOrder,
  notifyOrder,
  resolvePayBase,
  type PayBase,
} from './server';
import { applyServerOrder, getOrder } from './store';
import { fmtYuan, type PayChannelKind, type PayOrderRow, type PayService, type ServerChannel } from './types';

/** 一条渠道的两种走法：scheme 给壳跳 app，webUrl 是给浏览器的退路 */
export interface JumpTarget {
  kind: PayChannelKind;
  label: string;
  scheme: string;
  webUrl: string;
}

export interface BuyOutcome {
  order: PayOrderRow;
  jumps: JumpTarget[];
  base: string;
}

/** 把 PayError 与人话对齐；UI 的 catch 统一走这里，不再各写各的 String(e) */
export function errText(e: unknown): string {
  if (e instanceof PayError) return e.message;
  return `出错了：${String((e as Error)?.message ?? e).slice(0, 80)}`;
}

/** 拿服务器地址；拿不到就抛「没有可用收费服务器」，让 UI 直接把这行显示出来 */
async function needBase(): Promise<PayBase> {
  const b = await resolvePayBase();
  if (!b) throw new PayError('offline', '没有可用的收费服务器：填一个地址，或在壳里把局域网服务开起来');
  return b;
}

function toJumps(base: string, channels: ServerChannel[] | undefined): JumpTarget[] {
  return (channels ?? []).map((c) => ({
    kind: c.kind,
    label: c.label,
    scheme: c.scheme,
    webUrl: absUrl(base, c.webUrl),
  }));
}

/** 下单并落到本库。返回订单 + 可以跳去哪 */
export async function buyOnce(svc: PayService, channel?: PayChannelKind): Promise<BuyOutcome> {
  const base = await needBase();
  const remote = await createOrder(base.url, { id: svc.id, title: svc.title, amountCents: svc.amountCents }, channel);
  const order = applyServerOrder(remote, svc);
  if (!order) throw new PayError('badjson', '服务器回了一张没有单号的单');
  return { order, jumps: toJumps(base.url, remote.channels), base: base.url };
}

/** 查一次单并落库（幂等：同一条单查十次也还是一条记录，只会把 notify_count 加上去） */
export async function refreshOrder(orderId: string, opts: { silent?: boolean } = {}): Promise<PayOrderRow | null> {
  const base = await needBase();
  const remote = await queryOrder(base.url, orderId);
  const row = applyServerOrder(remote);
  if (!opts.silent) {
    if (row?.status === 'paid') showToast(`已到账：${row.serviceTitle} ${fmtYuan(row.amountCents)}`, 3200);
    else if (row) showToast(`${row.serviceTitle}：${statusLabel(row.status)}`, 3200);
  }
  return row;
}

/** 取消一张待支付单（只有还没过期、没结清的能取消，服务器会挡） */
export async function cancelOrder(orderId: string): Promise<PayOrderRow | null> {
  const base = await needBase();
  const remote = await driveOrder(base.url, orderId, 'cancel');
  return applyServerOrder(remote);
}

/** 走服务器的手动驱动（测试线专用：假扮「用户其实付了 / 付失败」） */
export async function drive(
  orderId: string,
  action: 'pay' | 'fail' | 'expire' | 'refund',
  channel?: PayChannelKind,
): Promise<PayOrderRow | null> {
  const base = await needBase();
  const remote = await driveOrder(base.url, orderId, action, channel);
  return applyServerOrder(remote);
}

/**
 * 模拟异步通知：先让服务器连发 times 次，再查一次单落库。
 * 通知本身不当账用（协议第 0 节），所以这里发完还是要查单。
 */
export async function notifyAndSync(orderId: string, times = 1): Promise<PayOrderRow | null> {
  const base = await needBase();
  await notifyOrder(base.url, orderId, times);
  return refreshOrder(orderId, { silent: true });
}

/**
 * 收银台 / 支付宝回来那一跳：地址栏带 ?orderId=&status=。
 * 读完立刻把这两个参数从地址栏抹掉（history.replaceState），否则刷新又会重查一次，
 * 用户还会看见一条莫名其妙的「已到账」。
 */
export async function syncFromReturnUrl(): Promise<PayOrderRow | null> {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  const orderId = q.get('orderId');
  if (!orderId) return null;
  q.delete('orderId');
  q.delete('status');
  const rest = q.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  try {
    return await refreshOrder(orderId, { silent: false });
  } catch (e) {
    showToast(errText(e), 3600);
    return getOrder(orderId);
  }
}

export function statusLabel(s: PayOrderRow['status']): string {
  return (
    {
      pending: '待支付',
      paid: '已到账',
      failed: '支付失败',
      cancelled: '已取消',
      expired: '已过期',
      refunded: '已退款',
    } as Record<PayOrderRow['status'], string>
  )[s];
}
