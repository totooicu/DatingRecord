// 设置 → 应用锁：设口令 / 改口令 / 关锁 / 空闲时长 / 立即锁定。
import { useState } from 'react';
import {
  IDLE_OPTIONS,
  MIN_PASSPHRASE,
  clearPassphrase,
  getIdleMs,
  hasPassphrase,
  lock,
  setIdleMs,
  setPassphrase,
  verifyPassphrase,
} from '../../core/lock';
import { getEncStatus } from '../../core/db';
import { bump } from '../../store';
import { Section } from './Section';

export function LockSection() {
  // 加密开着的时候，口令归「本地库加密」管——两处各设一个会让人记混。
  // 但「锁着」这个状态仍然成立：开机那次解锁同时算应用锁解锁，
  // 空闲超时照样生效，所以 on 该是 true，只是不给改口令的表单。
  const encOn = getEncStatus() === 'open';
  const [on, setOn] = useState(hasPassphrase());
  const [idle, setIdle] = useState(getIdleMs());
  // 未设口令：两栏新口令
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  // 已设口令：当前口令 + （可选）新口令
  const [cur, setCur] = useState('');
  const [next1, setNext1] = useState('');
  const [next2, setNext2] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const say = (m: string) => {
    setMsg(m);
    setErr('');
  };

  const fail = (m: string) => {
    setErr(m);
    setMsg('');
  };

  const turnOn = () => {
    if (pw1.length < MIN_PASSPHRASE) return fail(`口令至少 ${MIN_PASSPHRASE} 位`);
    if (pw1 !== pw2) return fail('两次输入不一致');
    setPassphrase(pw1);
    setPw1('');
    setPw2('');
    setOn(true);
    say('应用锁已开启，下次打开会先要口令');
    bump();
  };

  const changePw = () => {
    if (!verifyPassphrase(cur)) return fail('当前口令不对');
    if (next1.length < MIN_PASSPHRASE) return fail(`新口令至少 ${MIN_PASSPHRASE} 位`);
    if (next1 !== next2) return fail('两次输入不一致');
    setPassphrase(next1);
    setCur('');
    setNext1('');
    setNext2('');
    say('口令已修改');
  };

  const turnOff = () => {
    if (!verifyPassphrase(cur)) return fail('当前口令不对');
    clearPassphrase();
    setCur('');
    setOn(false);
    say('应用锁已关闭');
    bump();
  };

  return (
    <Section title="应用锁" desc="打开应用先要口令，空闲超时自动盖上。">
      <p className="muted small">
        说明：口令只做「随手翻看」的拦截，hash 存在本机浏览器里；库数据本身没有加密（那是另一件事，见本地库加密）。
        解锁后本次会话内敏感字段不再打码。
      </p>

      {!on ? (
        <div className="lock-form">
          <label>
            新口令
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
          <button className="btn btn-primary" onClick={turnOn}>
            开启应用锁
          </button>
        </div>
      ) : (
        <>
          <div className="lock-row">
            <span>空闲自动锁定</span>
            <select
              value={idle}
              onChange={(e) => {
                const v = Number(e.target.value);
                setIdle(v);
                setIdleMs(v);
              }}
            >
              {IDLE_OPTIONS.map((o) => (
                <option key={o.ms} value={o.ms}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="lock-row">
            <button className="btn" onClick={() => lock()}>
              立即锁定
            </button>
          </div>

          {encOn ? (
            <p className="muted small">
              口令由「本地库加密」管理——加密开着的时候，开机那一次输入同时算应用锁解锁。
              要改口令请去「本地库加密」。
            </p>
          ) : (
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
                value={next1}
                autoComplete="new-password"
                onChange={(e) => setNext1(e.target.value)}
              />
            </label>
            <label>
              新口令再输一次
              <input
                type="password"
                value={next2}
                autoComplete="new-password"
                onChange={(e) => setNext2(e.target.value)}
              />
            </label>
            <div className="lock-acts">
              <button className="btn" onClick={changePw}>
                修改口令
              </button>
              <button className="btn btn-danger" onClick={turnOff}>
                关闭应用锁
              </button>
            </div>
          </div>
          )}
        </>
      )}

      {msg && <p className="lock-ok">{msg}</p>}
      {err && <p className="lock-err">{err}</p>}
    </Section>
  );
}
