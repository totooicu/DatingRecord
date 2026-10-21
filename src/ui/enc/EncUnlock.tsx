// 启动时的加密解锁界面。
//
// 为什么单独一个门而不复用应用锁的 LockScreen：时机不同。应用锁出现在
// 「应用已经跑起来之后」，而这个出现在「库还读不出来的时候」——它挡在
// initDb 前面，用户不输对口令，整个 React 树都不会挂上。
//
// 界面本身很薄：输口令或恢复码 → unlockEnc() → 成功了通知外层继续启动。

import { useState } from 'react';
import { unlockEnc } from '../../core/db';

export function EncUnlock({ onUnlocked }: { onUnlocked: () => void }) {
  const [mode, setMode] = useState<'pass' | 'recovery'>('pass');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    setBusy(true);
    const ok = mode === 'pass' ? await unlockEnc(pw, false) : await unlockEnc(code, true);
    setBusy(false);
    if (!ok) {
      setErr(mode === 'pass' ? '口令不对，再试一次' : '恢复码不对，再检查一遍');
      return;
    }
    onUnlocked();
  };

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="lock-icon" aria-hidden="true">
          🔐
        </div>
        <h2>这个库已加密</h2>
        <p className="muted small">输入口令才能读出里面的内容。</p>

        <div className="lock-form">
          {mode === 'pass' ? (
            <label>
              口令
              <input
                type="password"
                value={pw}
                autoComplete="current-password"
                autoFocus
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </label>
          ) : (
            <label>
              恢复码
              <input
                value={code}
                autoComplete="off"
                autoFocus
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </label>
          )}

          {err && <p className="lock-err">{err}</p>}

          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            {busy ? '正在解密…' : '解锁'}
          </button>
          <button
            className="btn btn-link"
            onClick={() => {
              setMode(mode === 'pass' ? 'recovery' : 'pass');
              setErr('');
            }}
          >
            {mode === 'pass' ? '忘了口令，用恢复码' : '用口令解锁'}
          </button>
        </div>
      </div>
    </div>
  );
}
