// 服务管理页：列出所有后台服务，显示运行状态，可开关自启动、点开服务页。
// 目前支持自启动的服务：背景音乐、自动打点、坚果云自动同步；注册表是通用的，以后加服务零成本。

import { PageHead } from '../common';
import { useServices, setServiceAutostart, type ServiceItem } from '../../core/runtime/store';
import { navigate } from '../../core/runtime/nav';
import { setAutostart as setMusicAutostart } from '../../core/runtime/music';
import { setAutoServiceAutostart, useLocationAuto } from '../../core/runtime/locationAuto';
import { setAutoEnabled } from '../../core/sync/auto';

function ServiceRow({ s }: { s: ServiceItem }) {
  const la = useLocationAuto();
  const open = () => navigate(s.target);
  const toggleAutostart = () => {
    if (s.kind === 'music') setMusicAutostart(!s.autostart);
    else if (s.kind === 'location') setAutoServiceAutostart(!s.autostart);
    // 自动同步的开关真相在库里（nutstore.auto），不是 localStorage：走 setAutoEnabled 两边一起改
    else if (s.kind === 'sync') setAutoEnabled(!s.autostart);
    else setServiceAutostart(s.id, !s.autostart);
  };
  // 背景音乐、自动打点、自动同步都支持自启动；自动打点要先选文件，没文件时开关禁用
  const autostartable = s.kind === 'music' || s.kind === 'location' || s.kind === 'sync';
  const locNoFile = s.kind === 'location' && !la.fileId;
  return (
    <div className="svc-row">
      <div className="svc-main">
        <div className="svc-title">{s.title}</div>
        <div className="svc-sub muted small">
          {/* note 是「要用户动手」的告警，优先占位；没有告警时才显示这活儿正在干什么（detail）：
              自动同步要说「上一趟是定时还是本机改动、结果如何」，音乐要说在放哪首 */}
          {s.running ? (s.note ? `运行中 · ${s.note}` : s.detail ? `运行中 · ${s.detail}` : '运行中') : '已停止'}
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
