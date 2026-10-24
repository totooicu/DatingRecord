// 服务管理页：列出所有后台服务，显示运行状态，可开关自启动、点开服务页。
// 目前唯一的真实服务是「背景音乐」；注册表是通用的，以后加服务零成本。

import { PageHead } from '../common';
import { useServices, setServiceAutostart, type ServiceItem } from '../../core/runtime/store';
import { navigate } from '../../core/runtime/nav';
import { setAutostart as setMusicAutostart } from '../../core/runtime/music';

function ServiceRow({ s }: { s: ServiceItem }) {
  const open = () => navigate(s.target);
  const toggleAutostart = () => {
    if (s.kind === 'music') setMusicAutostart(!s.autostart);
    else setServiceAutostart(s.id, !s.autostart);
  };
  // 目前只有背景音乐支持自启动（自动打点要先选文件，开机自启没有意义）
  const autostartable = s.kind === 'music';
  return (
    <div className="svc-row">
      <div className="svc-main">
        <div className="svc-title">{s.title}</div>
        <div className="svc-sub muted small">
          {s.running ? (s.note ? `运行中 · ${s.note}` : '运行中') : '已停止'}
        </div>
      </div>
      {autostartable ? (
        <label className="svc-auto" title="开软件自动启动">
          <input type="checkbox" checked={s.autostart} onChange={toggleAutostart} />
          自启动
        </label>
      ) : (
        <span className="svc-auto muted small" title="该服务需要先手动准备，不支持自启动">
          —
        </span>
      )}
      <button className="svc-open" onClick={open}>
        打开
      </button>
    </div>
  );
}

export function ServicesPage({ onBack }: { onBack: () => void }) {
  const services = useServices();
  return (
    <div className="pane pane-solo">
      <PageHead title="服务" onBack={onBack} />
      <div className="svc-list">
        {services.length === 0 && <p className="muted">还没有后台服务。</p>}
        {services.map((s) => (
          <ServiceRow key={s.id} s={s} />
        ))}
      </div>
    </div>
  );
}
