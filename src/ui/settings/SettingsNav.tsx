// 设置目录：手机端是首页，宽屏常驻在左栏
import { SETTINGS_ENTRIES, type SettingsKey } from './sections';

export function SettingsNav({
  active,
  onPick,
}: {
  active: SettingsKey;
  onPick: (k: SettingsKey) => void;
}) {
  return (
    <div className="settings-nav">
      <div className="pane-head">
        <strong>设置目录</strong>
      </div>
      <ul className="settings-nav-list">
        {SETTINGS_ENTRIES.map((s) => (
          <li key={s.key}>
            <button
              className={s.key === active ? 'settings-nav-item settings-nav-item-on' : 'settings-nav-item'}
              onClick={() => onPick(s.key)}
            >
              <span className="settings-nav-title">{s.title}</span>
              <span className="settings-nav-hint">{s.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
