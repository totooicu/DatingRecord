// 服务管理页：列出所有后台服务，显示运行状态，可开关自启动、点开服务页。
// 目前支持自启动的服务：背景音乐、自动打点；注册表是通用的，以后加服务零成本。

import { PageHead } from '../common';
import { useServices, setServiceAutostart, type ServiceItem } from '../../core/runtime/store';
import { navigate } from '../../core/runtime/nav';
import { setAutostart as setMusicAutostart } from '../../core/runtime/music';
import { setAutoServiceAutostart, useLocationAuto } from '../../core/runtime/locationAuto';

function ServiceRow({ s }: { s: ServiceItem }) {
  const la = useLocationAuto();
  const open = () => navigate(s.target);
  const toggleAutostart = () => {
    if (s.kind === 'music') setMusicAutostart(!s.autostart);
    else if (s.kind === 'location') setAutoServiceAutostart(!s.autostart);
    else setServiceAutostart(s.id, !s.autostart);
  };
  // 背景音乐、自动打点都支持自启动；自动打点要先选文件，没文件时开关禁用
  const autostartable = s.kind === 'music' || s.kind === 'location';
  const locNoFile = s.kind === 'location' && !la.fileId;
  return (
    <div className="svc-row">
      <div className="svc-main">
        <div className="svc-title">{s.title}</div>
        <div className="svc-sub muted small">
          {s.running ? (s.note ? `运行中 · ${s.note}` : '运行中') : '已停止'}
        </div>
      </div>
      {autostartable ? (
        <label className="svc-auto" title={locNoFile ? '请先在定位面板选择打点文件' : '开软件自动启动'}>
          <input type="checkbox" checked={s.autostart} disabled={locNoFile} onChange={toggleAutostart} />
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
