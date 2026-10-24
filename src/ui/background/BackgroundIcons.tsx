// head 右侧：运行中的服务图标 + 任务通知图标。

import { useBackground } from './useBackground';
import { dismissTask } from '../../core/background/center';

export function BackgroundIcons() {
  const { services, tasks } = useBackground();
  const runningServices = services.filter((s) => s.running);
  if (runningServices.length === 0 && tasks.length === 0) return null;
  return (
    <div className="bg-icons" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {runningServices.map((s) => (
        <span key={s.id} title={`服务运行中：${s.name}`}
          style={{
            fontSize: 16, padding: '2px 6px', borderRadius: 6,
            background: 'rgba(33,150,243,0.12)', border: '1px solid rgba(33,150,243,0.3)',
          }}>
          {s.icon}
        </span>
      ))}
      {tasks.map((t) => (
        <span key={t.id} title={t.status === 'running' ? `${t.name}进行中` : `${t.name}已完成`}
          onClick={() => {
            t.onOpen();
            if (t.status === 'done') dismissTask(t.id);
          }}
          style={{
            fontSize: 16, padding: '2px 6px', borderRadius: 6, cursor: 'pointer',
            background: t.status === 'running' ? 'rgba(217,83,107,0.15)' : 'rgba(76,175,80,0.15)',
            border: `1px solid ${t.status === 'running' ? 'rgba(217,83,107,0.4)' : 'rgba(76,175,80,0.4)'}`,
          }}>
          {t.icon}
        </span>
      ))}
    </div>
  );
}
