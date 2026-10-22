// 设置目录：手机端是首页，宽屏常驻在左栏。
//
// 每条入口带一个图标 + 标题 + 一句说明。说明不是把标题抄一遍，而是「这一页
// 现在是什么样」——隐私与安全那条直接显示锁开没开、加密开没开、隐私模式开没开，
// 光看目录就知道状态，不必进去再出来确认。
import { useMemo } from 'react';
import { getEncStatus } from '../../core/db';
import { hasPassphrase } from '../../core/lock';
import { usePrivacyMode } from '../../privacy';
import { useVersion } from '../../store';
import { SettingsIcon, GroupIcon } from './navIcons';
import {
  GROUP_TITLES,
  SETTINGS_ENTRIES,
  type SettingsEntry,
  type SettingsGroup,
  type SettingsKey,
} from './sections';

const GROUP_ORDER: SettingsGroup[] = ['general', 'security', 'people', 'data'];

export function SettingsNav({
  active,
  onPick,
}: {
  active: SettingsKey;
  onPick: (k: SettingsKey) => void;
}) {
  // v 只是为了让 hasPassphrase / getEncStatus 在数据变更后重算
  const v = useVersion();
  const privacy = usePrivacyMode();

  const hints = useMemo(() => {
    const lock = hasPassphrase() ? '锁开' : '锁关';
    const enc = getEncStatus() === 'none' ? '加密关' : '加密开';
    return {
      security: `${lock} · ${enc} · 隐私模式${privacy ? '开' : '关'}`,
    } as Partial<Record<SettingsKey, string>>;
  }, [v, privacy]);

  const groups = GROUP_ORDER.map((g) => ({
    g,
    items: SETTINGS_ENTRIES.filter((e) => e.group === g),
  })).filter((x) => x.items.length > 0);

  return (
    <div className="settings-nav">
      <div className="pane-head">
        <strong>设置目录</strong>
      </div>
      {groups.map(({ g, items }) => (
        <div className="settings-nav-group" key={g}>
          <div className="settings-nav-group-title">
            <GroupIcon g={g} />
            <span>{GROUP_TITLES[g]}</span>
          </div>
          <ul className="settings-nav-list">
            {items.map((s) => (
              <li key={s.key}>
                <NavItem
                  entry={s}
                  active={s.key === active}
                  hint={hints[s.key] ?? s.hint}
                  onPick={onPick}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function NavItem({
  entry,
  active,
  hint,
  onPick,
}: {
  entry: SettingsEntry;
  active: boolean;
  hint: string;
  onPick: (k: SettingsKey) => void;
}) {
  return (
    <button
      className={active ? 'settings-nav-item settings-nav-item-on' : 'settings-nav-item'}
      onClick={() => onPick(entry.key)}
    >
      <span className="settings-nav-icon" aria-hidden>
        <SettingsIcon k={entry.key} />
      </span>
      <span className="settings-nav-text">
        <span className="settings-nav-title">{entry.title}</span>
        <span className="settings-nav-hint">{hint}</span>
      </span>
    </button>
  );
}
