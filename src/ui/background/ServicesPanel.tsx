// 设置 → 后台服务管理页。
//
// 列出所有已注册服务：运行状态、自启动开关、启动/停止按钮。
// 任务不在这管理（任务是一次性的，head 上看通知即可）。

import { useBackground } from './useBackground';
import { toggleService, upsertService } from '../../core/background/center';
import { showToast as toast } from '../toast';

export function ServicesPanel() {
  const { services } = useBackground();

  return (
    <div className="music-panel">
      <div className="music-now">
        <div className="music-disc">⚙️</div>
        <div className="music-meta">
          <div className="music-title">后台服务</div>
          <div className="music-sub muted small">长期运行的能力，可设自启动</div>
        </div>
      </div>

      <ul className="music-list">
        {services.length === 0 && <li className="muted small">暂无已注册服务。启动自动打点后会出现在这里。</li>}
        {services.map((s) => (
          <li key={s.id} className="music-row" style={{ flexWrap: 'wrap' }}>
            <span className="music-row-name">
              {s.icon} {s.name}
              <span className="muted small" style={{ marginLeft: 8 }}>
                {s.running ? '运行中' : '已停止'}
              </span>
            </span>
            <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={s.autostart}
                onChange={(e) => {
                  upsertService({ ...s, autostart: e.target.checked });
                  s.onToggleAuto?.(e.target.checked);
                  toast(e.target.checked ? '已设自启动' : '已取消自启动');
                }} />
              自启动
            </label>
            <button className="music-add-btn" onClick={() => toggleService(s.id)}>
              {s.running ? '停止' : '启动'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
