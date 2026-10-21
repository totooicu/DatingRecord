// 应用锁外壳：锁定时整个 App 不渲染（不是盖一层遮罩——
// 遮罩底下的 DOM 照样能被读屏软件和 devtools 看见，敏感字段也一样）。
import { type ReactNode, useEffect } from 'react';
import { idleCheckMs, idleExpired, lock, touch } from '../../core/lock';
import { useLocked } from './useLocked';
import { LockScreen } from './LockScreen';

export function LockGate({ children }: { children: ReactNode }) {
  const locked = useLocked();

  useEffect(() => {
    if (locked) return;
    const arm = () => touch();
    // 后台标签页里定时器会被节流，所以回到前台时补一次判断
    const onVisible = () => {
      if (document.visibilityState === 'visible' && idleExpired()) lock();
    };
    const timer = window.setInterval(() => {
      if (idleExpired()) lock();
    }, idleCheckMs());
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
    window.addEventListener('wheel', arm, { passive: true });
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
      window.removeEventListener('wheel', arm);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [locked]);

  if (locked) return <LockScreen />;
  return <>{children}</>;
}
