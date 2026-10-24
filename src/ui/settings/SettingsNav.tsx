// 设置目录：手机端是首页，宽屏常驻在左栏。
//
// 每条入口带一个图标 + 标题 + 一句说明。说明不是把标题抄一遍，而是「这一页
// 现在是什么样」——隐私与安全那条直接显示锁开没开、加密开没开、隐私模式开没开，
// 光看目录就知道状态，不必进去再出来确认。
//
// 带子页的入口（AI / 功能体验 / 备份与分享）在目录里只占一行，右侧带箭头；
// 子页本身不进目录，在子页里时亮的是父级那一行。
import { useMemo } from 'react';
import { getEncStatus } from '../../core/db';
import { hasPassphrase } from '../../core/lock';
import { usePrivacyMode } from '../../privacy';
import { useVersion } from '../../store';
import { SettingsIcon, GroupIcon } from './navIcons';
import {
  GROUP_TITLES,
  SETTINGS_ENTRIES,
  SUB_PAGES,
  parentOf,
  type SettingsEntry,
  type SettingsGroup,
  type SettingsKey,
} from './sections';

const GROUP_ORDER: SettingsGroup[] = ['general', 'ai', 'security', 'people', 'data', 'trial'];

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

  // 目录里只列「一级入口」：是别人子页的条目跳过（由父级那一行进去）
  const groups = GROUP_ORDER.map((g) => ({
    g,
    items: SETTINGS_ENTRIES.filter((e) => e.group === g && !parentOf(e.key)),
  })).filter((x) => x.items.length > 0);

  // 子页高亮时，目录上亮父级
  const activeTop = parentOf(active) ?? active;

  return (
    <div className="settings-nav">
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
                  active={s.key === activeTop}
                  hint={hints[s.key] ?? s.hint}
                  onPick={onPick}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {/* 副名放在目录最下方居中：它只是气质，不该挤占「设置目录」和第一组入口之间的视线 */}
      <p className="settings-slogan">
        朝汇生活碎片，夕拾旧日回想
        <span className="settings-slogan-en">Gather Dawn’s Moments, Recall Them Later</span>
      </p>
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
  const hasSub = (SUB_PAGES[entry.key]?.length ?? 0) > 0;
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
      {hasSub && (
        <span className="settings-nav-more" aria-hidden>
          ›
        </span>
      )}
    </button>
  );
}
