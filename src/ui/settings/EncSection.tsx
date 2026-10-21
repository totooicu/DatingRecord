// 设置 → 本地库加密。
//
// 和「应用锁」的分工：应用锁拦的是「正在看的这个页面」，加密拦的是
// 「磁盘上的那份文件」。锁可以被 devtools 绕，加密不能——所以设了口令
// 之后，应用锁的口令也交给这里管（一个口令，少一次敲键盘）。
//
// 关键事实：会话主密钥只在内存里，刷新即丢。所以「关闭加密」必须真的把
// 明文写回去、把密文删掉，否则用户会以为关掉了，其实下次开门还是要口令。

import { useState } from 'react';
import { enableEnc, getEncStatus } from '../../core/db';
import { hasPassphrase, setPassphrase } from '../../core/lock';
import { bump } from '../../store';
import { Section } from './Section';
import { EncOpenPanel } from './EncOpenPanel';
import { RecoveryCodeCard } from './RecoveryCodeCard';

export function EncSection() {
  const [status, setStatus] = useState(getEncStatus());
  // 开启流程：输口令 → 生成恢复码 → 抄码确认
  const [enabling, setEnabling] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [recovery, setRecovery] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const say = (m: string) => {
    setMsg(m);
    setErr('');
  };
  const fail = (m: string) => {
    setErr(m);
    setMsg('');
  };

  /** 生成恢复码并进入「抄码」步骤。此时加密还没真开 */
  const startEnable = async () => {
    if (pw1.length < 4) return fail('口令至少 4 位');
    if (pw1 !== pw2) return fail('两次输入不一致');
    setBusy(true);
    const code = await enableEnc(pw1);
    setBusy(false);
    if (!code) return fail('开启失败：库里没有可加密的数据');
    setRecovery(code);
  };

  /** 用户抄完恢复码，加密正式生效 */
  const finishEnable = () => {
    // 一个口令：应用锁也用同一个，免得开机连敲两次
    setPassphrase(pw1);
    setRecovery(null);
    setEnabling(false);
    setPw1('');
    setPw2('');
    setStatus(getEncStatus());
    say('本地库加密已开启，之后每次打开都要输入口令');
    bump();
  };

  if (recovery) {
    return (
      <Section title="本地库加密" desc="最后一步：把恢复码收好。">
        <RecoveryCodeCard code={recovery} onConfirm={finishEnable} onCancel={() => setRecovery(null)} />
      </Section>
    );
  }

  return (
    <Section title="本地库加密" desc="把整库加密后再存进浏览器，磁盘上那份文件读不出内容。">
      <p className="muted small">
        做法：随机生成一把主密钥加密整库，再用你的口令派生出另一把钥匙把它包住，磁盘上只留包好的密文。
        主密钥只在内存里，刷新页面就丢——所以口令忘了可以用恢复码开门。它不是万能的：
        应用开着的时候数据仍在内存里，那部分归应用锁管。
      </p>

      {status === 'open' ? (
        <EncOpenPanel
          onDone={(m) => {
            setStatus(getEncStatus());
            if (m) say(m);
          }}
        />
      ) : (
        <>
          <p className="muted small">状态：未加密。库以明文存在本机浏览器里，能读到文件的人就能读到内容。</p>
          {!enabling ? (
            <button className="btn btn-primary" onClick={() => setEnabling(true)}>
              开启本地库加密
            </button>
          ) : (
            <div className="lock-form">
              <label>
                新口令（至少 4 位）
                <input
                  type="password"
                  value={pw1}
                  autoComplete="new-password"
                  onChange={(e) => setPw1(e.target.value)}
                />
              </label>
              <label>
                再输一次
                <input
                  type="password"
                  value={pw2}
                  autoComplete="new-password"
                  onChange={(e) => setPw2(e.target.value)}
                />
              </label>
              <div className="lock-acts">
                <button className="btn btn-primary" disabled={busy} onClick={startEnable}>
                  生成恢复码
                </button>
                <button className="btn" onClick={() => setEnabling(false)}>
                  取消
                </button>
              </div>
              <p className="muted small">
                接下来会生成一串恢复码，请准备好纸笔或密码管理器。
                {hasPassphrase() && ' 它同时会成为应用锁的口令。'}
              </p>
            </div>
          )}
        </>
      )}

      {msg && <p className="lock-ok">{msg}</p>}
      {err && <p className="lock-err">{err}</p>}
    </Section>
  );
}
