// 锁定页：整个 App 被 LockGate 换成的这一屏。
// 输错 GIVEUP_AFTER 次后开放「放弃口令」——库没加密，把人锁在门外的代价比防错漏更大。
import { useState } from 'react';
import { GIVEUP_AFTER, clearPassphrase, unlock, verifyPassphrase } from '../../core/lock';

export function LockScreen() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [fails, setFails] = useState(0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyPassphrase(pw)) {
      setErr('');
      unlock();
      return;
    }
    setFails((n) => n + 1);
    setErr('口令不对，再试试');
    setPw('');
  };

  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={submit}>
        <svg className="lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
          <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
        </svg>
        <h2>已锁定</h2>
        <p className="muted">输入口令解锁</p>

        <input
          type="password"
          value={pw}
          autoFocus
          autoComplete="current-password"
          placeholder="口令"
          onChange={(e) => {
            setPw(e.target.value);
            setErr('');
          }}
        />
        {err && <p className="lock-err">{err}</p>}

        <button type="submit" className="btn btn-primary">
          解锁
        </button>

        <p className="lock-note">
          已输错 {fails} 次
          {fails >= GIVEUP_AFTER && (
            <button
              type="button"
              className="lock-giveup"
              onClick={() => {
                if (confirm('放弃口令会清掉应用锁设置（数据不受影响，因为库本身没有加密）。确定？')) {
                  clearPassphrase();
                }
              }}
            >
              忘记口令？放弃锁定
            </button>
          )}
        </p>
      </form>
    </div>
  );
}
