// pay_orders 的读写：订单在服务器的状态，落到本库这一行。
//
// 幂等在这里，不在 UI：同一条订单可能被「收银台回跳查单」「手动查单」「异步通知」
// 各打一次，全都走 applyServerOrder 这一个口。主键仍是本地 ULID（同步埋点要求），
// 服务器单号 order_id 上 UNIQUE 索引——重复单撞不上第二条行，购买记录就不会多出来。

import { appendOplog, getDeviceId, queryAll, queryOne, run, transact } from '../db';
import { newId } from '../id';
import { hlcNow } from '../time';
import { bump } from '../../store';
import { mergeStatus, type PayOrderRow, type PayStatus, type ServerOrder } from './types';

interface Row {
  id: string;
  order_id: string;
  service_id: string;
  service_title: string;
  amount_cents: number;
  status: string;
  channel: string;
  trade_no: string;
  notify_count: number;
  expire_at: number | null;
  paid_at: number | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `SELECT id,order_id,service_id,service_title,amount_cents,status,channel,trade_no,
  notify_count,expire_at,paid_at,created_at,updated_at FROM pay_orders`;

const STATUSES: PayStatus[] = ['pending', 'paid', 'failed', 'cancelled', 'expired', 'refunded'];

function toOrder(r: Row): PayOrderRow {
  return {
    id: r.id,
    orderId: r.order_id,
    serviceId: r.service_id,
    serviceTitle: r.service_title,
    amountCents: r.amount_cents,
    status: (STATUSES as string[]).includes(r.status) ? (r.status as PayStatus) : 'pending',
    channel: r.channel,
    tradeNo: r.trade_no,
    notifyCount: r.notify_count,
    expireAt: r.expire_at,
    paidAt: r.paid_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function find(orderId: string): PayOrderRow | null {
  const r = queryOne<Row>(`${SELECT} WHERE order_id=?`, [orderId]);
  return r ? toOrder(r) : null;
}

/**
 * 把服务器回的一单落进本库。返回落完之后的行；orderId 为空时返回 null（垃圾进不来）。
 * 已经是 paid 的单不会被改回 pending（mergeStatus 里钉着），所以重复到账不会重复记。
 */
export function applyServerOrder(o: ServerOrder, svc?: { id: string; title: string; amountCents: number }): PayOrderRow | null {
  const orderId = String(o?.orderId ?? '').trim();
  if (!orderId) return null;
  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());
  const serviceId = String(o.serviceId ?? svc?.id ?? '');
  const serviceTitle = String(o.serviceTitle ?? svc?.title ?? serviceId);
  const amountCents = Number.isFinite(o.amountCents) ? Math.round(o.amountCents) : (svc?.amountCents ?? 0);
  const status: PayStatus = (STATUSES as string[]).includes(o.status) ? o.status : 'pending';

  transact(() => {
    const cur = find(orderId);
    if (!cur) {
      run(
        `INSERT INTO pay_orders
         (id,order_id,service_id,service_title,amount_cents,status,channel,trade_no,notify_count,
          expire_at,paid_at,device_id,rev,hlc,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          newId('po'),
          orderId,
          serviceId,
          serviceTitle,
          amountCents,
          status,
          String(o.channel ?? ''),
          String(o.tradeNo ?? ''),
          1,
          Number.isFinite(o.expireAt) ? o.expireAt : null,
          status === 'paid' ? (Number.isFinite(o.paidAt) ? o.paidAt : Date.now()) : null,
          getDeviceId(),
          1,
          hlc,
          now,
          now,
        ],
      );
      appendOplog('pay_order', orderId, 'insert', { serviceId, amountCents, status });
      return;
    }
    const next = mergeStatus(cur.status, status);
    // 已付且其它字段都没变时，只把「同步过几次」的计数加一——这条路径就是重复通知，
    // 除了计数什么都不该动，购买记录才不会变成两条。
    run(
      `UPDATE pay_orders SET status=?, channel=?, trade_no=?, notify_count=notify_count+1,
       paid_at=?, expire_at=?, amount_cents=?, service_title=?, rev=rev+1, hlc=?, updated_at=?
       WHERE order_id=?`,
      [
        next,
        String(o.channel ?? '') || cur.channel,
        String(o.tradeNo ?? '') || cur.tradeNo,
        next === 'paid' ? (cur.paidAt ?? (Number.isFinite(o.paidAt) ? o.paidAt : Date.now())) : cur.paidAt,
        Number.isFinite(o.expireAt) ? o.expireAt : cur.expireAt,
        amountCents || cur.amountCents,
        serviceTitle || cur.serviceTitle,
        hlc,
        now,
        orderId,
      ],
    );
    appendOplog('pay_order', orderId, 'update', { status: next });
  });
  // 写完直接让全库视图重查：这一张表没有别的状态容器，靠调用方各自记得 bump()
  // 迟早会漏（remote/router、sync/auto 这些「页面直接写库」的路径也是这么收口的）。
  bump();
  return find(orderId);
}

/** 全部订单（含待支付），按下单时间倒序 */
export function listOrders(): PayOrderRow[] {
  return queryAll<Row>(`${SELECT} WHERE deleted_at IS NULL ORDER BY created_at DESC, order_id DESC`).map(toOrder);
}

/** 购买记录 = 已付的单。一次性服务允许同一件买多次，所以一条付款一条记录 */
export function listPurchases(): PayOrderRow[] {
  return listOrders().filter((o) => o.status === 'paid' || o.status === 'refunded');
}

export function pendingOrders(): PayOrderRow[] {
  return listOrders().filter((o) => o.status === 'pending');
}

export function getOrder(orderId: string): PayOrderRow | null {
  return find(orderId);
}

/** 这个服务已经买过几次（UI 上「已购 N 次」和按钮是否还亮着靠它） */
export function purchaseCount(serviceId: string): number {
  return queryAll<{ n: number }>(
    `SELECT COUNT(*) AS n FROM pay_orders WHERE service_id=? AND status='paid' AND deleted_at IS NULL`,
    [serviceId],
  )[0]?.n ?? 0;
}

export function totalSpentCents(): number {
  return queryAll<{ s: number | null }>(
    `SELECT SUM(amount_cents) AS s FROM pay_orders WHERE status='paid' AND deleted_at IS NULL`,
  )[0]?.s ?? 0;
}
