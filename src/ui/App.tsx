import { useEffect, useMemo, useState } from 'react';
import { PersonDetail, PersonList } from './Persons';
import { CollectionDetail, CollectionTree } from './Collections';
import { Timeline, TimelineFilters, defaultFilter, type TimelineFilter } from './Timeline';
import { Settings } from './Settings';
import { EventForm } from './EventForm';
import { hasAnyPerson, loadSampleData } from '../core/seed';
import { getRoot } from '../core/repo/collections';
import { listPersons } from '../core/repo/persons';
import { useVersion, bump } from '../store';

type Tab = 'persons' | 'collections' | 'timeline' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'persons', label: '人物' },
  { key: 'collections', label: '事件集' },
  { key: 'timeline', label: '时间线' },
  { key: 'settings', label: '设置' },
];

export default function App() {
  const v = useVersion();
  const [tab, setTab] = useState<Tab>('persons');
  const [personId, setPersonId] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<TimelineFilter>(defaultFilter);
  const [quickEvent, setQuickEvent] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);

  const isEmpty = useMemo(() => !hasAnyPerson(), [v]);

  // 首次进入自动选中第一项，避免右侧空白
  useEffect(() => {
    if (!personId) {
      const first = listPersons()[0];
      if (first) setPersonId(first.id);
    }
    if (!collectionId) {
      const root = getRoot();
      if (root) setCollectionId(root.id);
    }
  }, [v, personId, collectionId]);

  return (
    <div className="app">
      <header className="topbar">
        <button className="menu-btn" onClick={() => setSideOpen((s) => !s)} aria-label="侧边栏">
          ☰
        </button>
        <div className="brand">
          <span className="brand-dot" />
          <span className="brand-text">约会记录</span>
        </div>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'tab tab-on' : 'tab'} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="topbar-right">
          {(tab === 'timeline' || tab === 'persons') && (
            <input
              className="search"
              value={keyword}
              placeholder={tab === 'persons' ? '搜索人物…' : '搜索事件…'}
              onChange={(e) => setKeyword(e.target.value)}
            />
          )}
          <button className="btn btn-primary" onClick={() => setQuickEvent(true)}>
            ＋ 记一件事
          </button>
        </div>
      </header>

      <div className="body">
        {tab !== 'settings' && (
          <>
            {sideOpen && <div className="side-mask" onClick={() => setSideOpen(false)} />}
            <aside className={sideOpen ? 'sidebar sidebar-open' : 'sidebar'}>
              {tab === 'persons' && (
                <PersonList
                  selectedId={personId}
                  onSelect={(id) => {
                    setPersonId(id);
                    setSideOpen(false);
                  }}
                  keyword={keyword}
                />
              )}
              {tab === 'collections' && (
                <CollectionTree
                  selectedId={collectionId}
                  onSelect={(id) => {
                    setCollectionId(id);
                    setSideOpen(false);
                  }}
                />
              )}
              {tab === 'timeline' && <TimelineFilters filter={filter} onChange={setFilter} />}
            </aside>
          </>
        )}

        <main className="content">
          {isEmpty && tab !== 'settings' ? (
            <div className="welcome">
              <h2>开始记录你们的故事</h2>
              <p className="muted">
                数据全部保存在你自己的浏览器里（SQLite + IndexedDB），随时可以导出成 JSON 备份文件。
              </p>
              <div className="row-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    loadSampleData();
                    bump();
                  }}
                >
                  载入示例数据看看效果
                </button>
                <button className="btn" onClick={() => setTab('settings')}>
                  导入已有备份
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setTab('persons');
                    setQuickEvent(false);
                  }}
                >
                  直接开始创建
                </button>
              </div>
            </div>
          ) : (
            <>
              {tab === 'persons' && (personId ? <PersonDetail id={personId} /> : <div className="pad muted">请选择或创建一位人物</div>)}
              {tab === 'collections' && (collectionId ? <CollectionDetail id={collectionId} /> : <div className="pad muted">请选择事件集</div>)}
              {tab === 'timeline' && <Timeline filter={filter} keyword={keyword} />}
              {tab === 'settings' && <Settings />}
            </>
          )}
        </main>
      </div>

      {quickEvent && (
        <EventForm
          onClose={() => {
            setQuickEvent(false);
            bump();
          }}
        />
      )}
    </div>
  );
}
