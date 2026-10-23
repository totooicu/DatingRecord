// 入口页共用的卡片列表：一行一个子页，图标 + 标题 + 一句说明 + 状态行。
//
// 「功能体验」和「备份与分享」都是「先选做哪件事，再进对应页」的结构，
// 共用一份排版，省得两页各写一套、字号和间距慢慢走样。
import { SettingsIcon } from './navIcons';
import type { SettingsKey } from './sections';

export interface HubEntry {
  key: SettingsKey;
  title: string;
  desc: string;
  /** 一句「现在是什么样」，和设置目录的 hint 同一套写法 */
  hint: string;
}

export function HubList({
  entries,
  onPick,
}: {
  entries: HubEntry[];
  onPick: (k: SettingsKey) => void;
}) {
  return (
    <ul className="settings-hub-list">
      {entries.map((e) => (
        <li key={e.key}>
          <button className="settings-hub-item" onClick={() => onPick(e.key)}>
            <span className="settings-hub-icon" aria-hidden>
              <SettingsIcon k={e.key} />
            </span>
            <span className="settings-hub-text">
              <span className="settings-hub-title">{e.title}</span>
              <span className="settings-hub-desc">{e.desc}</span>
              <span className="settings-hub-hint">{e.hint}</span>
            </span>
            <span className="settings-hub-arrow" aria-hidden>
              ›
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
