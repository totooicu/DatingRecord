// 服务管理页：列出所有后台服务，显示运行状态，可开关自启动、点开服务页。
// 目前支持自启动的服务：背景音乐、自动打点、坚果云自动同步、跨设备操作；注册表是通用的，以后加服务零成本。

import { PageHead } from '../common';
import { useServices, setServiceAutostart, type ServiceItem } from '../../core/runtime/store';
import { navigate } from '../../core/runtime/nav';
import { setAutostart as setMusicAutostart } from '../../core/runtime/music';
import { setAutoServiceAutostart, useLocationAuto } from '../../core/runtime/locationAuto';
import { setAutoEnabled } from '../../core/sync/auto';
import { setDataShareAutostart, useDataShare } from '../../core/runtime/dataShare';
import { showToast } from '../toast';

function ServiceRow({ s }: { s: ServiceItem }) {
  const la = useLocationAuto();
  const ds = useDataShare();
  const open = () => navigate(s.target);
  const toggleAutostart = () => {
    if (s.kind === 'music') setMusicAutostart(!s.autostart);
    else if (s.kind === 'location') setAutoServiceAutostart(!s.autostart);
    if (s.kind === 'music') setMusicAutostart(!s.autostart);
    else if (s.kind === 'location') setAutoServiceAutostart(!s.autostart);
    // 自动同步的开关真相在库里（nutstore.auto），不是 localStorage：走 setAutoEnabled 两边一起改
    else if (s.kind === 'sync') setAutoEnabled(!s.autostart);
    else if (s.kind === 'remote') {
      void setDataShareAutostart(!s.autostart).catch((e) => {
        showToast(e instanceof Error ? e.message : String(e), 3200);
      });
    } else setServiceAutostart(s.id, !s.autostart);
  };
  // 背景音乐、自动打点、自动同步、跨设备操作都支持自启动；后两者需要先决条件：
  // 自动打点要先选文件；跨设备操作要跑在壳里（浏览器没有端口服务）。
  const autostartable = s.kind === 'music' || s.kind === 'location' || s.kind === 'sync' || s.kind === 'remote';
  const locNoFile = s.kind === 'location' && !la.fileId;
  const remoteNoShell = s.kind === 'remote' && ds.supported === false;
  const remoteProbing = s.kind === 'remote' && ds.supported === null;
  const disabled = locNoFile || remoteNoShell || remoteProbing;
  const autoTitle = locNoFile
    ? '请先在定位面板选择打点文件'
    : remoteNoShell
      ? '当前环境没有壳端服务（浏览器里请用中继）'
      : remoteProbing
        ? '正在检测壳端服务…'
        : s.kind === 'remote'
          ? '开软件自动启动，并在手机开机时注册前台服务'
          : '开软件自动启动';
  return (
    <div className="svc-row">
      <div className="svc-main">
        <div className="svc-title">{s.title}</div>
        <div className="svc-sub muted small">
          {/* note 是「要用户动手」的告警，优先占位；没有告警时才显示这活儿正在干什么（detail）：
              自动同步要说「上一趟是定时还是本机改动、结果如何」，音乐要说在放哪首 */}
          {s.running ? (s.note ? `运行中 · ${s.note}` : s.detail ? `运行中 · ${s.detail}` : '运行中') : '已停止'}
          {s.kind === 'remote' && ds.address && ` · http://${ds.address}:${ds.port}`}
        </div>
      </div>
      {autostartable ? (
        <label className="svc-auto" title={autoTitle}>
          <input type="checkbox" checked={s.autostart} disabled={disabled} onChange={toggleAutostart} />
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
