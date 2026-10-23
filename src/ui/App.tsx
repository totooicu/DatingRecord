import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Timeline, TimelineFilters, defaultFilter, type TimelineFilter } from './timeline';
import { Settings } from './settings/Settings';
import { EventForm } from './event';
import { PageHead, useModalOpenCount } from './common';
import { PersonsPane, CollectionsPane } from './Panes';
import { Welcome } from './Welcome';
import { TopBar } from './TopBar';
import { UndoSnackbar } from './undo/UndoSnackbar';
import { ToastHost } from './toast';
import { TabBar } from './TabBar';
import { Calendar } from './calendar';
import { hasAnyPerson } from '../core/seed';
import { getRoot } from '../core/repo/collections';
import { listPersons } from '../core/repo/persons';
import { useVersion, bump } from '../store';
import { getEvent } from '../core/repo/events';
import { setEventOpener } from './openEvent';
import { hides, usePrivacyMode } from '../privacy';
import { setPersonOpener } from './openPerson';
import { canLeave } from './navGuard';
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
  | { k: 'calendar' }
  | { k: 'settings' };

export default function App() {
  const v = useVersion();
  const privacy = usePrivacyMode();
  const [view, setView] = useState<View>({ k: 'list', s: 'persons' });
  const [personId, setPersonId] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<TimelineFilter>(defaultFilter);
  const [quickEvent, setQuickEvent] = useState(false);
  /** 从别处（文件库的引用列表）点进来要打开的事件 */
  const [jumpEventId, setJumpEventId] = useState<string | null>(null);

  const isEmpty = useMemo(() => !hasAnyPerson(), [v]);
  // 欢迎页只拦一次：点过「直接开始创建」就放行，否则空库时那个按钮是死的
  // （isEmpty 仍为真，早退分支会把下面的新建事件弹窗一起吃掉）
  const [welcomeDone, setWelcomeDone] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollMemo = useRef<Record<string, number>>({});
  // 弹窗打开时收起 FAB，避免浮层压住弹窗内容
  const modalCount = useModalOpenCount();

  // 文件库里点「引用它的事件」→ 切到时间线并打开那条事件
  useEffect(() => {
    setEventOpener((id) => {
      const e = getEvent(id);
      // 隐私模式下，标了隐私的事件不在时间线里，文件库跳转也不该把它亮出来
      if (!e || hides(e)) return;
      setView({ k: 'timeline' });
      setJumpEventId(id);
    });
    return () => setEventOpener(null);
  }, []);

  // 文件库里点「谁在用它当头像」→ 切到人物列表并打开那个人的详情
  useEffect(() => {
    setPersonOpener((id) => {
      setPersonId(id);
      setView({ k: 'detail', s: 'persons', id });
    });
    return () => setPersonOpener(null);
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

  const section: TabKey =
    view.k === 'timeline' || view.k === 'settings' || view.k === 'calendar' ? view.k : view.s;

  const gotoTab = (key: TabKey) => {
    // AI 忙着的时候不让切走：这一轮会中断，会话还在组件 state 里
    if (!canLeave()) return;
    setKeyword('');
    if (key === 'timeline') setView({ k: 'timeline' });
    else if (key === 'calendar') setView({ k: 'calendar' });
    else if (key === 'settings') setView({ k: 'settings' });
    else setView({ k: 'list', s: key });
  };

  /** 日历点某一天 → 时间线只看那一天（清掉其它筛选，避免两个条件互相打架） */
  const pickDay = useCallback((key: string) => {
    const from = new Date(`${key}T00:00:00`).getTime();
    const to = from + 86400000 - 1;
    setKeyword('');
    setFilter({ ...defaultFilter, fromTs: from, toTs: to, dayLabel: key });
    setView({ k: 'timeline' });
  }, []);

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

  if (isEmpty && !welcomeDone && view.k !== 'settings') {
    return (
      <Welcome
        onImport={() => gotoTab('settings')}
        onCreate={() => {
          setWelcomeDone(true);
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
    <div className={`app at-${view.k}${privacy ? ' privacy-on' : ''}`} data-section={section}>
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
              onClearDay={() => setFilter(defaultFilter)}
              onBackToCalendar={() => setView({ k: 'calendar' })}
            />
          </div>
        )}
        {view.k === 'calendar' && (
          <div className="pane pane-solo">
            <PageHead title="日历" />
            <Calendar onPickDay={pickDay} />
          </div>
        )}
        {view.k === 'settings' && (
          <div className="pane pane-solo">
            {/* 标题由 Settings 自己渲染：子页要把标题换成该设置项的名字 */}
            <Settings />
          </div>
        )}
      </div>

      <TabBar section={section} onTab={gotoTab} />

      <UndoSnackbar />
      <ToastHost />

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
