// 敏感字段遮罩：有值时默认不渲染明文控件，点「显示」才展开，空闲自动收起
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { hasPassphrase } from '../../core/lock';

const REVEAL_MS = 15000;

/** 值是否值得遮（空值没什么可泄的，直接按普通字段渲染） */
export function hasMaskableValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

/** 掩码长度按原文长度给一点反馈，但封顶，避免长文本拖出满屏点 */
function maskOf(value: unknown): string {
  let len = 8;
  if (typeof value === 'string') len = Math.min(value.trim().length, 8);
  else if (typeof value === 'number') len = Math.min(String(value).length, 8);
  else if (Array.isArray(value)) len = Math.min(value.join('').length, 8);
  return '•'.repeat(Math.max(len, 3));
}

export function SensitiveMask({ value, children }: { value: unknown; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  const timer = useRef<number | null>(null);
  // 设过应用锁且已经解锁 = 本会话验过身份，这时再逐字段打码只是徒增麻烦；
  // 没设口令时，遮罩就是唯一的防线，仍然照常生效。
  // （锁着的时候整个 App 都不渲染，走不到这里。）
  const trusted = hasPassphrase();

  const arm = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setShown(false);
    }, REVEAL_MS);
  };

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => clear, []);

  if (trusted || !hasMaskableValue(value)) return <>{children}</>;

  return (
    <span className="sens-wrap">
      {shown ? (
        // 展开态：控件本身在这里，任何交互都会重置空闲计时
        <span className="sens-real" onPointerDown={arm} onKeyDown={arm}>
          {children}
        </span>
      ) : (
        <span className="sens-mask">{maskOf(value)}</span>
      )}
      <button
        type="button"
        className="sens-eye"
        aria-pressed={shown}
        onClick={() => {
          if (shown) {
            clear();
            setShown(false);
          } else {
            setShown(true);
            arm();
          }
        }}
      >
        {shown ? '隐藏' : '显示'}
      </button>
    </span>
  );
}
