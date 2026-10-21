// 设置 → 本地库加密 → 「已开启」状态的面板。
//
// 从 EncSection 拆出来：开启流程是一次性的，管理口令是日常的，
// 两者的状态机叠在一起会把文件撑到两百多行。

import { useState } from 'react';
import {
  changeEncPassphrase,
  disableEnc,
  getEncRecord,
  resetEncPassphraseWithRecovery,
} from '../../core/db';
import { clearPassphrase, setPassphrase, verifyPassphrase } from '../../core/lock';
import { bump } from '../../store';
import { fmtMeta } from './Section';

export function EncOpenPanel({ onDone }: { onDone: (msg?: string) => void }) {
  const rec = getEncRecord();
  const [cur, setCur] = useState('');
  const [n1, setN1] = useState('');
  const [n2, setN2] = useState('');
  const [rc, setRc] = useState('');
  const [rcNew, setRcNew] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const fail = (m: string) => {
    setErr(m);
  };

  const changePw = async () => {
    if (!verifyPassphrase(cur)) return fail('当前口令不对');
    if (n1.length < 4) return fail('新口令至少 4 位');
    if (n1 !== n2) return fail('两次输入不一致');
    setBusy(true);
    const ok = await changeEncPassphrase(n1);
    setBusy(false);
    if (!ok) return fail('修改失败');
    setPassphrase(n1);
    setCur('');
    setN1('');
    setN2('');
    onDone('口令已修改，数据不用重新加密');
    bump();
  };

  const resetWithRc = async () => {
    if (rcNew.length < 4) return fail('新口令至少 4 位');
    setBusy(true);
    const bytes = await resetEncPassphraseWithRecovery(rc, rcNew);
    setBusy(false);
    if (!bytes) return fail('恢复码不对');
    setPassphrase(rcNew);
    setRc('');
    setRcNew('');
    onDone('已用恢复码重设口令');
    bump();
  };

  const turnOff = async () => {
    if (!verifyPassphrase(cur)) return fail('当前口令不对');
    if (!window.confirm('关闭后，库会以明文存回本机。确定关闭加密？')) return;
    setBusy(true);
    const ok = await disableEnc();
    setBusy(false);
    if (!ok) return fail('关闭失败');
    setCur('');
    // 应用锁的口令是启用加密时捎带设的，加密关了它也该走——
    // 否则用户会莫名被一道自己没设过的锁拦在门外
    clearPassphrase();
    bump();
    onDone('加密已关闭，数据已写回明文');
  };

  return (
    <>
      <div className="lock-row">
        <span>状态</span>
        <strong>已加密</strong>
      </div>
      <div className="lock-row">
        <span>上次加密</span>
        <span>{rec ? fmtMeta(rec.updatedAt) : '—'}</span>
      </div>

      <div className="lock-form">
        <label>
          当前口令
          <input
            type="password"
            value={cur}
            autoComplete="current-password"
            onChange={(e) => setCur(e.target.value)}
          />
        </label>
        <label>
          新口令
          <input
            type="password"
            value={n1}
            autoComplete="new-password"
            onChange={(e) => setN1(e.target.value)}
          />
        </label>
        <label>
          新口令再输一次
          <input
            type="password"
            value={n2}
            autoComplete="new-password"
            onChange={(e) => setN2(e.target.value)}
          />
        </label>
        <div className="lock-acts">
          <button className="btn" disabled={busy} onClick={changePw}>
            修改口令
          </button>
          <button className="btn btn-danger" disabled={busy} onClick={turnOff}>
            关闭加密
          </button>
        </div>
      </div>

      <p className="muted small enc-forgot">口令忘了？用恢复码重设一个：</p>
      <div className="lock-form">
        <label>
          恢复码
          <input
            value={rc}
            autoComplete="off"
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
            onChange={(e) => setRc(e.target.value)}
          />
        </label>
        <label>
          新口令
          <input
            type="password"
            value={rcNew}
            autoComplete="new-password"
            onChange={(e) => setRcNew(e.target.value)}
          />
        </label>
        <button className="btn" disabled={busy} onClick={resetWithRc}>
          用恢复码重设口令
        </button>
      </div>

      {err && <p className="lock-err">{err}</p>}
    </>
  );
}
