// 一次性服务购买：状态机、商品目录、金额格式。
//
// 这一期**没有账户余额**，也没有自动续费——一张订单 = 买一个服务 = 一条购买记录，
// 买完就结清。所以这里没有「扣次数」「到期清零」那套，只有订单状态怎么合并。
//
// 协议见 docs/PAY_MOCK.md（测试线，不进 main）。

/** 服务器认识的 6 个状态，一个都不多 */
export type PayStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired' | 'refunded';

export type PayChannelKind = 'alipay' | 'wechat';

/** 服务器上回给页面的渠道（scheme 是给壳跳 app 的，webUrl 是网页退路） */
export interface ServerChannel {
  kind: PayChannelKind;
  label: string;
  scheme: string;
  webUrl: string;
}

/** `/__pay/order` 与 `/__pay/order?id=` 的响应体 */
export interface ServerOrder {
  orderId: string;
  status: PayStatus;
  amountCents: number;
  currency?: string;
  expireAt?: number;
  paidAt?: number;
  tradeNo?: string;
  channel?: PayChannelKind | string;
  serviceId?: string;
  serviceTitle?: string;
  channels?: ServerChannel[];
}

/** 本库 pay_orders 一行 */
export interface PayOrderRow {
  /** 本地 ULID（同步埋点要求主键是自己生成的，服务器单号只当业务键） */
  id: string;
  orderId: string;
  serviceId: string;
  serviceTitle: string;
  amountCents: number;
  status: PayStatus;
  channel: string;
  tradeNo: string;
  notifyCount: number;
  expireAt: number | null;
  paidAt: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 商品目录写死在代码里：这一期测的是「钱的流程」，不是「能不能配商品」。
 * 金额一律**分**——整条链路不许出现浮点传钱（0.1 + 0.2 那种坑不该在钱上重现）。
 */
export interface PayService {
  id: string;
  title: string;
  desc: string;
  amountCents: number;
}

export const PAY_SERVICES: PayService[] = [
  { id: 'ai.urgent', title: 'AI 加急解析', desc: '把一张大图插队进模型队列，只买这一次。', amountCents: 600 },
  { id: 'export.pdf', title: '整库 PDF 导出', desc: '一次性导出全部事件成一份 PDF。', amountCents: 1200 },
  { id: 'share.pro', title: '分享页去标识', desc: '分享出去的页面不再带「由本机生成」那一行。', amountCents: 3000 },
];

export function serviceOf(id: string): PayService | null {
  return PAY_SERVICES.find((s) => s.id === id) ?? null;
}

/** 钱只按分存，只在显示时换算 */
export function fmtYuan(cents: number): string {
  return `¥${(Math.round(cents) / 100).toFixed(2)}`;
}

/**
 * 状态合并：本地只跟随服务器，**唯一不跟的是「已付被改回未付」**。
 * 页面同时会有三条路在改同一条订单——收银台回跳、手动「查单」、异步通知——
 * 乱序到达是常态；把已付改回待支付，用户的购买记录会凭空消失，那比慢一步到账严重得多。
 * 想真的退掉，得由服务器明确说 refunded（这条照常放行）。
 */
export function mergeStatus(cur: PayStatus, next: PayStatus): PayStatus {
  if (cur === next) return next;
  if (cur === 'paid' && next !== 'refunded') return 'paid';
  return next;
}

/** 待支付单能不能继续付（过期了就别再给「继续支付」的入口） */
export function canPayAgain(r: PayOrderRow, now = Date.now()): boolean {
  return r.status === 'pending' && (r.expireAt === null || r.expireAt > now);
}

/** 能不能取消：只有还没过期、也还没结清的单 */
export function canCancel(r: PayOrderRow, now = Date.now()): boolean {
  return canPayAgain(r, now);
}
