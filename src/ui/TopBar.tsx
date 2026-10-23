// 顶部栏：品牌 + 桌面端页签 + 搜索 + 新建按钮。
// 只在宽屏显示（CSS 控制），手机端由底部 TabBar 承担导航。

import { TABS, type TabKey } from './icons';
import { usePrivacyMode, setPrivacyMode } from '../privacy';

export function TopBar({
  section,
  onTab,
  keyword,
  onKeyword,
  onNew,
}: {
  section: TabKey;
  onTab: (k: TabKey) => void;
  keyword: string;
  onKeyword: (k: string) => void;
  onNew: () => void;
}) {
  const privacy = usePrivacyMode();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-dot" />
        <span className="brand-text">朝汇夕思</span>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={section === t.key ? 'tab tab-on' : 'tab'}
            onClick={() => onTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="topbar-right">
        <button
          className={privacy ? 'btn btn-privacy' : 'btn'}
          title={privacy ? '隐私模式：已隐藏标记为隐私的内容' : '隐私模式：开启后隐藏标记为隐私的内容'}
          aria-pressed={privacy}
          onClick={() => setPrivacyMode(!privacy)}
        >
          隐私模式{privacy ? '·开' : ''}
        </button>
        <input
          className="search"
          type="search"
          value={keyword}
          placeholder="搜索人物"
          onChange={(e) => onKeyword(e.target.value)}
        />
        <button className="btn btn-primary" onClick={onNew}>
          ＋ 记一件事
        </button>
      </div>
    </header>
  );
}
