// 「服务购买（测试）」——一次性服务购买整条路的界面。
//
// 只活在 test/payment-recharge 这条线上（协议见 docs/PAY_MOCK.md）。三件事按顺序摆：
//   ① 收费服务器在哪（手填 / 壳端服务探到的端口）；② 商品目录，买了就下单；
//   ③ 订单：待支付的能继续付 / 查单 / 取消，已付的进购买记录，能退款、能模拟重复回调。
//
// 「跳到支付宝 / 微信」不自动跳：下单后把两条路（scheme 给壳拉 app、webUrl 是网页退路）
// 明摆出来让人点。自动跳在浏览器里是「点了没反应还以为坏了」，在壳里又会把用户从
// 正在填的页面上拽走；而且只有明摆着，回归才能验真的把链接构对了。

import { useEffect, useMemo, useState } from 'react';
import { useVersion } from '../../store';
import { showToast } from '../toast';
import { ConfirmButton, Empty } from '../common';
import { Paginator } from '../common/Paginator';
import { usePaged } from '../common/usePaged';
import { usePageSize } from '../prefs';
import { Section } from './Section';
import {
  buyOnce,
  cancelOrder,
  drive,
  errText,
  notifyAndSync,
  refreshOrder,
  statusLabel,
  syncFromReturnUrl,
  type JumpTarget,
} from '../../core/pay/flow';
import { getManualBase, normalizeBase, resolvePayBase, setManualBase, listOrders as remoteOrders, type PayBase } from '../../core/pay/server';
import { listOrders, listPurchases, purchaseCount, totalSpentCents } from '../../core/pay/store';
import { canCancel, fmtYuan, PAY_SERVICES, type PayChannelKind, type PayOrderRow } from '../../core/pay/types';

/** 一单下单后攒出来的跳转信息（渠道列表 + 这一单是谁） */
interface JumpState {
  orderId: string;
  title: string;
  amountCents: number;
  jumps: JumpTarget[];
}

export function PaySection() {
  const v = useVersion();
  const pageSize = usePageSize();
  const [base, setBase] = useState<PayBase | null>(null);
  const [draft, setDraft] = useState(getManualBase());
  const [jump, setJump] = useState<JumpState | null>(null);
  const [busy, setBusy] = useState<string>('');

  // 进来先看有没有「从收银台退回来」的那一跳，再探一次服务器
  useEffect(() => {
    let live = true;
    void (async () => {
      const back = await syncFromReturnUrl();
      if (live && back) setBusy('');
      const b = await resolvePayBase().catch(() => null);
      if (live) setBase(b);
    })();
    return () => {
      live = false;
    };
  }, []);

  const orders = useMemo(() => listOrders(), [v]);
  const pending = useMemo(() => orders.filter((o) => o.status === 'pending'), [orders]);
  const purchases = useMemo(() => listPurchases(), [v]);
  const pagedPurchases = usePaged(purchases, pageSize);

  /** 所有按钮都走这一个包装：同一个时刻只让一件事在跑，失败统一 toast 人话 */
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      showToast(errText(e), 3600);
    } finally {
      // 写库经 transact/run 已经 markDirty，防抖落盘是持久层的事，这里不再插手
      setBusy('');
    }
  };

  const buy = (svcId: string, channel: PayChannelKind) => {
    const svc = PAY_SERVICES.find((s) => s.id === svcId);
    if (!svc) return;
    void run(`buy:${svcId}:${channel}`, async () => {
      const out = await buyOnce(svc, channel);
      setJump({ orderId: out.order.orderId, title: out.order.serviceTitle, amountCents: out.order.amountCents, jumps: out.jumps });
      showToast(`已下单 ${out.order.orderId}（${fmtYuan(out.order.amountCents)}）`, 3200);
    });
  };

  /** 继续支付：再下一次同一张单——服务器对「同服务同金额的待支付单」会返回同一张 */
  const resume = (o: PayOrderRow, channel: PayChannelKind) => {
    void run(`resume:${o.orderId}`, async () => {
      const out = await buyOnce({ id: o.serviceId, title: o.serviceTitle, amountCents: o.amountCents, desc: '' }, channel);
      setJump({ orderId: out.order.orderId, title: out.order.serviceTitle, amountCents: out.order.amountCents, jumps: out.jumps });
    });
  };

  const saveBase = () => {
    const ok = normalizeBase(draft);
    if (draft.trim() && !ok) {
      showToast('地址得是 http:// 或 https:// 开头', 3200);
      return;
    }
    setManualBase(draft);
    void run('base', async () => {
      const b = await resolvePayBase();
      setBase(b);
      showToast(b ? `收费服务器：${b.url}（${b.from === 'shell' ? '壳端服务' : '手填'}）` : '没有可用收费服务器', 3600);
    });
  };

  return (
    <div className="settings-intro">
      <Section
        title="收费服务器"
        desc="测试线：钱由壳那台局域网服务器模拟，没有真商户号。地址留空就退回探测壳端服务。"
        extra={<span className="muted small">{base ? (base.from === 'shell' ? '壳端服务' : '手填') : '未连接'}</span>}
      >
        <div className="loc-row">
          <input
            className="music-name-input pay-base-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="留空 = 用壳端服务；浏览器里测试填 http://127.0.0.1:端口"
            aria-label="收费服务器地址"
          />
          <button className="btn btn-sm pay-base-save" onClick={saveBase} disabled={busy === 'base'}>
            保存
          </button>
          {base && (
            <button
              className="btn btn-sm btn-ghost pay-probe"
              disabled={busy === 'probe'}
              onClick={() =>
                void run('probe', async () => {
                  const rows = await remoteOrders(base.url);
                  showToast(`服务器上 ${rows.length} 张单`, 3200);
                })
              }
            >
              试连
            </button>
          )}
        </div>
        <p className="muted small pay-base-state">
          {base ? `当前：${base.url}` : '没有可用收费服务器——填个地址，或在壳里把「跨设备操作」的局域网服务开起来。'}
        </p>
      </Section>

      <Section title="一次性服务" desc="买一次算一次，没有余额、不会自动续费。金额按分存，只在显示时换算。">
        <ul className="music-list pay-services">
          {PAY_SERVICES.map((s) => {
            const n = purchaseCount(s.id);
            return (
              <li key={s.id} className="music-row pay-service" data-service={s.id}>
                <span className="music-row-name">
                  {s.title} · {fmtYuan(s.amountCents)}
                  <span className="muted small"> {s.desc}</span>
                </span>
                <span className="music-row-size muted small">{n ? `已购 ${n} 次` : '未购'}</span>
                <button
                  type="button"
                  className="btn btn-sm pay-channel pay-channel-alipay"
                  disabled={!base || busy !== ''}
                  onClick={() => buy(s.id, 'alipay')}
                >
                  支付宝
                </button>
                <button
                  type="button"
                  className="btn btn-sm pay-channel pay-channel-wechat"
                  disabled={!base || busy !== ''}
                  onClick={() => buy(s.id, 'wechat')}
                >
                  微信
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      {jump && (
        <Section
          title="去支付"
          desc="壳里点「打开 app」会拉起支付宝 / 微信；浏览器里那条没反应是正常的，走右边网页收银台。"
          extra={
            <button type="button" className="btn btn-sm btn-ghost pay-jump-close" onClick={() => setJump(null)}>
              收起
            </button>
          }
        >
          <p className="muted small pay-jump-order">
            {jump.orderId} · {jump.title} · {fmtYuan(jump.amountCents)}
          </p>
          <ul className="music-list pay-jumps">
            {jump.jumps.map((j) => (
              <li key={j.kind} className="music-row pay-jump" data-channel={j.kind}>
                <span className="music-row-name">{j.label}</span>
                <a className="btn btn-sm pay-scheme" href={j.scheme}>
                  打开 app
                </a>
                <a className="btn btn-sm btn-ghost pay-cashier" href={j.webUrl} target="_blank" rel="noreferrer">
                  网页收银台
                </a>
              </li>
            ))}
          </ul>
          <div className="loc-row">
            <button
              type="button"
              className="btn btn-sm btn-primary pay-queried"
              disabled={busy !== ''}
              onClick={() =>
                void run('queried', async () => {
                  await refreshOrder(jump.orderId);
                  setJump(null);
                })
              }
            >
              我付好了，查单
            </button>
          </div>
        </Section>
      )}

      <Section title={`待支付（${pending.length}）`}>
        {pending.length === 0 ? (
          <Empty text="没有待支付的单子" compact />
        ) : (
          <ul className="music-list pay-pending">
            {pending.map((o) => (
              <li key={o.id} className="music-row pay-order-row" data-order={o.orderId}>
                <span className="music-row-name">
                  {o.serviceTitle} · {fmtYuan(o.amountCents)}
                  <span className="muted small"> {o.orderId}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm pay-refresh"
                  disabled={busy !== ''}
                  onClick={() => void run(`q:${o.orderId}`, () => refreshOrder(o.orderId))}
                >
                  查单
                </button>
                <button
                  type="button"
                  className="btn btn-sm pay-resume"
                  disabled={!base || busy !== '' || !canCancel(o)}
                  onClick={() => resume(o, (o.channel as PayChannelKind) || 'alipay')}
                >
                  继续支付
                </button>
                <button
                  type="button"
                  className="btn btn-sm pay-paid-fake"
                  disabled={!base || busy !== ''}
                  title="测试线：假扮用户其实付了"
                  onClick={() => void run(`p:${o.orderId}`, () => drive(o.orderId, 'pay', (o.channel as PayChannelKind) || undefined))}
                >
                  当它已付
                </button>
                {canCancel(o) && (
                  <ConfirmButton
                    className="pay-cancel"
                    text="取消"
                    danger
                    compact
                    confirmText={`取消 ${o.orderId}？`}
                    onConfirm={() => void run(`c:${o.orderId}`, () => cancelOrder(o.orderId))}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="购买记录"
        extra={<span className="muted small pay-spent">共 {purchases.length} 条 · 花掉 {fmtYuan(totalSpentCents())}</span>}
      >
        {purchases.length === 0 ? (
          <Empty text="还没买过东西" compact />
        ) : (
          <>
            <ul className="music-list pay-purchases">
              {pagedPurchases.pageItems.map((o) => (
                <li key={o.id} className="music-row pay-order-row" data-order={o.orderId}>
                  <span className="music-row-name">
                    {o.serviceTitle} · {fmtYuan(o.amountCents)}
                    <span className={`muted small pay-status pay-status-${o.status}`}> {statusLabel(o.status)}</span>
                    <span className="muted small"> 同步 {o.notifyCount} 次</span>
                  </span>
                  <span className="music-row-size muted small">{o.tradeNo}</span>
                  {o.status === 'paid' && (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm pay-notify-twice"
                        disabled={!base || busy !== ''}
                        title="测试线：连发两次异步回调再查单，验幂等"
                        onClick={() => void run(`n:${o.orderId}`, () => notifyAndSync(o.orderId, 2))}
                      >
                        重复回调
                      </button>
                      <ConfirmButton
                        className="pay-refund"
                        text="退款"
                        danger
                        compact
                        confirmText={`退掉 ${o.orderId}？`}
                        onConfirm={() => void run(`r:${o.orderId}`, () => drive(o.orderId, 'refund'))}
                      />
                    </>
                  )}
                </li>
              ))}
            </ul>
            <Paginator paged={pagedPurchases} />
          </>
        )}
      </Section>
    </div>
  );
}
