import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Timeline, TimelineFilters, defaultFilter, type TimelineFilter } from './timeline';
import { Settings } from './settings/Settings';
import { EventForm } from './event';
import { PageHead, useModalOpenCount } from './common';
import { PersonsPane, CollectionsPane } from './Panes';
import { Welcome } from './Welcome';
import { TopBar } from './TopBar';
import { TabBar } from './TabBar';
import { hasAnyPerson } from '../core/seed';
import { getRoot } from '../core/repo/collections';
import { listPersons } from '../core/repo/persons';
import { useVersion, bump } from '../store';
import { getEvent } from '../core/repo/events';
import { setEventOpener } from './openEvent';
import type { TabKey } from './icons';

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
  /** 从别处（文件库的引用列表）点进来要打开的事件 */
  const [jumpEventId, setJumpEventId] = useState<string | null>(null);

  const isEmpty = useMemo(() => !hasAnyPerson(), [v]);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollMemo = useRef<Record<string, number>>({});
  // 弹窗打开时收起 FAB，避免浮层压住弹窗内容
  const modalCount = useModalOpenCount();

  // 文件库里点「引用它的事件」→ 切到时间线并打开那条事件
  useEffect(() => {
    setEventOpener((id) => {
      if (!getEvent(id)) return;
      setView({ k: 'timeline' });
      setJumpEventId(id);
    });
    return () => setEventOpener(null);
  }, []);

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

  if (isEmpty && view.k !== 'settings') {
    return (
      <Welcome
        onImport={() => gotoTab('settings')}
        onCreate={() => {
          setView({ k: 'list', s: 'persons' });
          setQuickEvent(true);
        }}
      />
    );
  }

  const listDetail = view.k === 'list' || view.k === 'detail';
  const paneProps = {
    detailMode: view.k === 'detail',
    detailId: view.k === 'detail' ? view.id : null,
    onBack: backToList,
    listRef,
  };
  // FAB 新建事件时，若在人物详情页则自动带上该人物
  const fabPersonId = view.k === 'detail' && view.s === 'persons' ? view.id : undefined;
  const fabCollectionId = view.k === 'detail' && view.s === 'collections' ? view.id : undefined;

  return (
    <div className={`app at-${view.k}`} data-section={section}>
      <TopBar
        section={section}
        onTab={gotoTab}
        keyword={keyword}
        onKeyword={setKeyword}
        onNew={() => setQuickEvent(true)}
      />

      <div className="stack">
        {listDetail && view.s === 'persons' && (
          <PersonsPane
            {...paneProps}
            selectedId={personId}
            onSelect={(id) => openDetail('persons', id)}
            onArchived={onPersonArchived}
            keyword={keyword}
            onKeyword={setKeyword}
          />
        )}
        {listDetail && view.s === 'collections' && (
          <CollectionsPane
            {...paneProps}
            selectedId={collectionId}
            onSelect={(id) => openDetail('collections', id)}
          />
        )}
        {view.k === 'timeline' && (
          <div className="pane pane-solo">
            <PageHead title="时间线" />
            <TimelineFilters filter={filter} onChange={setFilter} />
            <Timeline
              filter={filter}
              keyword={keyword}
              openId={jumpEventId}
              onOpened={() => setJumpEventId(null)}
            />
          </div>
        )}
        {view.k === 'settings' && (
          <div className="pane pane-solo">
            <PageHead title="设置与数据" />
            <Settings />
          </div>
        )}
      </div>

      <TabBar section={section} onTab={gotoTab} />

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
