// 底部导航栏：手机端主导航，宽屏隐藏。

import { TabIcon, TABS, type TabKey } from './icons';

export function TabBar({ section, onTab }: { section: TabKey; onTab: (k: TabKey) => void }) {
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={section === t.key ? 'tabbar-item tabbar-item-on' : 'tabbar-item'}
          onClick={() => onTab(t.key)}
        >
          <span className="tabbar-icon">
            <TabIcon k={t.key} />
          </span>
          <span className="tabbar-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
