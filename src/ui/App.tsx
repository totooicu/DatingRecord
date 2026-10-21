import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PersonDetail, PersonList } from './Persons';
import { CollectionDetail, CollectionTree } from './Collections';
import { Timeline, TimelineFilters, defaultFilter, type TimelineFilter } from './Timeline';
import { Settings } from './Settings';
import { EventForm } from './EventForm';
import { PageHead, useModalOpenCount } from './common';
import { hasAnyPerson, loadSampleData } from '../core/seed';
import { getRoot } from '../core/repo/collections';
import { getPerson } from '../core/repo/persons';
import { getCollection } from '../core/repo/collections';
import { listPersons } from '../core/repo/persons';
import { useVersion, bump } from '../store';

type TabKey = 'persons' | 'collections' | 'timeline' | 'settings';

/** 内联 SVG 图标：不依赖 emoji 字体，各平台渲染一致，且能跟随 currentColor 变色 */
function TabIcon({ k }: { k: TabKey }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (k) {
    case 'persons':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.6" />
          <path d="M4.5 20c0-3.6 3.4-5.6 7.5-5.6s7.5 2 7.5 5.6" />
        </svg>
      );
    case 'collections':
      return (
        <svg {...common}>
          <path d="M3.5 7.5a2 2 0 0 1 2-2h3.2l1.8 2h7.5a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case 'timeline':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.4" />
          <path d="M12 7.6V12l3 1.8" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="2.8" />
          <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
        </svg>
      );
  }
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'persons', label: '人物' },
  { key: 'collections', label: '事件集' },
  { key: 'timeline', label: '时间线' },
  { key: 'settings', label: '设置' },
];

/**
 * 页面栈视图状态。
 * 手机端按 view 切「列表 / 详情」；宽屏（≥1024px）由 CSS 忽略 data-view，两端同屏。
 * 这样全站不需要任何 JS 判断屏幕宽度。
 */
type View =
  | { k: 'list'; s: 'persons' | 'collections' }
  | { k: 'detail'; s: 'persons' | 'collections'; id: string }
  | { k: 'timeline' }
  | { k: 'settings' };

export default function App() {
  const v = useVersion();
  const [view, setView] = useState<View>({ k: 'list', s: 'persons' });
  const [personId, setPersonId] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<TimelineFilter>(defaultFilter);
  const [quickEvent, setQuickEvent] = useState(false);

  const isEmpty = useMemo(() => !hasAnyPerson(), [v]);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollMemo = useRef<Record<string, number>>({});
  // 弹窗打开时收起 FAB，避免浮层压住弹窗内容
  const modalCount = useModalOpenCount();

  // 首次进入自动选中第一项，避免宽屏右侧空白
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

  const section: TabKey = view.k === 'timeline' || view.k === 'settings' ? view.k : view.s;

  const gotoTab = (key: TabKey) => {
    setKeyword('');
    if (key === 'timeline') setView({ k: 'timeline' });
    else if (key === 'settings') setView({ k: 'settings' });
    else setView({ k: 'list', s: key });
  };

  /** 进入详情前记住列表滚动位置，返回时还原 */
  const openDetail = useCallback((s: 'persons' | 'collections', id: string) => {
    scrollMemo.current[s] = listRef.current?.scrollTop ?? 0;
    if (s === 'persons') setPersonId(id);
    else setCollectionId(id);
    setView({ k: 'detail', s, id });
  }, []);

  const backToList = useCallback(() => {
    setView({ k: 'list', s: view.k === 'detail' ? view.s : 'persons' });
  }, [view]);

  /** 归档某人后：退回列表，并把选中顺延到下一位（宽屏右侧也随之换人） */
  const onPersonArchived = useCallback((nextId: string | null) => {
    setPersonId(nextId);
    setView({ k: 'list', s: 'persons' });
  }, []);

  // 回到列表页时还原滚动位置
  useEffect(() => {
    if (view.k === 'list') {
      const top = scrollMemo.current[view.s] ?? 0;
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = top;
      });
    }
  }, [view]);

  const detailTitle =
    view.k === 'detail'
      ? view.s === 'persons'
        ? getPerson(view.id)?.displayName ?? '人物'
        : getCollection(view.id)?.name ?? '事件集'
      : '';

  // FAB 新建事件时，若在人物详情页则自动带上该人物
  const fabPersonId = view.k === 'detail' && view.s === 'persons' ? view.id : undefined;
  const fabCollectionId = view.k === 'detail' && view.s === 'collections' ? view.id : undefined;

  /** 渲染列表 + 详情两栏。此处 view 已收窄为 list | detail，可安全取 view.s */
  const renderListDetail = (s: 'persons' | 'collections') => {
    const detailId = s === 'persons' ? personId : collectionId;
    return (
      <>
        <div className="pane pane-list" ref={listRef}>
          {s === 'persons' ? (
            <PersonList
              selectedId={personId}
              onSelect={(id) => openDetail('persons', id)}
              keyword={keyword}
              onKeyword={setKeyword}
            />
          ) : (
            <CollectionTree selectedId={collectionId} onSelect={(id) => openDetail('collections', id)} />
          )}
        </div>
        <div className="pane pane-detail">
          {view.k === 'detail' ? (
            <>
              <PageHead title={detailTitle} onBack={backToList} />
              {s === 'persons' ? (
                <PersonDetail id={view.id} onArchived={onPersonArchived} />
              ) : (
                <CollectionDetail id={view.id} />
              )}
            </>
          ) : detailId ? (
            <>
              <PageHead title={s === 'persons' ? getPerson(detailId)?.displayName ?? '人物' : getCollection(detailId)?.name ?? '事件集'} />
              {s === 'persons' ? (
                <PersonDetail id={detailId} onArchived={onPersonArchived} />
              ) : (
                <CollectionDetail id={detailId} />
              )}
            </>
          ) : (
            <>
              <PageHead title={s === 'persons' ? '人物' : '事件集'} />
              <div className="pad muted">{s === 'persons' ? '请选择或创建一位人物' : '请选择事件集'}</div>
            </>
          )}
        </div>
      </>
    );
  };

  if (isEmpty && view.k !== 'settings') {
    return (
      <div className="app at-welcome" data-section="persons">
        <div className="pane pane-solo">
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
              <button className="btn" onClick={() => gotoTab('settings')}>
                导入已有备份
              </button>
              <button
                className="btn"
                onClick={() => {
                  setView({ k: 'list', s: 'persons' });
                  setQuickEvent(true);
                }}
              >
                直接开始创建
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app at-${view.k}`} data-section={section}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span className="brand-text">约会记录</span>
        </div>
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={section === t.key ? 'tab tab-on' : 'tab'}
              onClick={() => gotoTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="topbar-right">
          <input
            className="search"
            type="search"
            value={keyword}
            placeholder="搜索人物"
            onChange={(e) => setKeyword(e.target.value)}
          />
          <button className="btn btn-primary" onClick={() => setQuickEvent(true)}>
            ＋ 记一件事
          </button>
        </div>
      </header>

      <div className="stack">
        {view.k === 'list' || view.k === 'detail' ? (
          renderListDetail(view.s)
        ) : view.k === 'timeline' ? (
          <div className="pane pane-solo">
            <PageHead title="时间线" />
            <TimelineFilters filter={filter} onChange={setFilter} />
            <Timeline filter={filter} keyword={keyword} />
          </div>
        ) : (
          <div className="pane pane-solo">
            <PageHead title="设置与数据" />
            <Settings />
          </div>
        )}
      </div>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={section === t.key ? 'tabbar-item tabbar-item-on' : 'tabbar-item'}
            onClick={() => gotoTab(t.key)}
          >
            <span className="tabbar-icon">
              <TabIcon k={t.key} />
            </span>
            <span className="tabbar-label">{t.label}</span>
          </button>
        ))}
      </nav>

      {/* 设置页没有「记一件事」的语境，按钮只会挡住内容，直接不渲染 */}
      {modalCount === 0 && section !== 'settings' && (
        <button className="fab" onClick={() => setQuickEvent(true)} aria-label="记一件事">
          ＋
        </button>
      )}

      {quickEvent && (
        <EventForm
          defaultPersonId={fabPersonId}
          defaultCollectionId={fabCollectionId}
          onClose={() => {
            setQuickEvent(false);
            bump();
          }}
        />
      )}
    </div>
  );
}
