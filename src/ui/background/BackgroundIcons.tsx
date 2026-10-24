// 全局浮动：运行中的服务图标 + 任务通知图标，固定在右上角。

import { useBackground } from './useBackground';
import { dismissTask } from '../../core/background/center';

export function BackgroundIcons() {
  const { services, tasks } = useBackground();
  const runningServices = services.filter((s) => s.running);
  if (runningServices.length === 0 && tasks.length === 0) return null;
  return (
    <div style={{
      position: 'fixed', top: 8, right: 8, zIndex: 9999,
      display: 'flex', gap: 6, alignItems: 'center',
    }}>
      {runningServices.map((s) => (
        <span key={s.id} title={`服务运行中：${s.name}`}
          style={{
            fontSize: 16, padding: '4px 8px', borderRadius: 8,
            background: 'rgba(33,150,243,0.9)', color: '#fff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
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
            fontSize: 16, padding: '4px 8px', borderRadius: 8, cursor: 'pointer',
            background: t.status === 'running' ? 'rgba(217,83,107,0.95)' : 'rgba(76,175,80,0.95)',
            color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}>
          {t.icon}
        </span>
      ))}
    </div>
  );
}
