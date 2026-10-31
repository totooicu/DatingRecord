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
import { RemoteStatusBar } from './RemoteStatusBar';
import { Calendar } from './calendar';
import { hasAnyPerson } from '../core/seed';
import { getRoot } from '../core/repo/collections';
import { listPersons } from '../core/repo/persons';
import { useVersion, bump } from '../store';
import { getEvent } from '../core/repo/events';
import { setEventOpener } from './openEvent';
import { hides, usePrivacyMode } from '../privacy';
import { setPersonOpener } from './openPerson';
import { setCollectionOpener } from './openCollection';
import { peekSnapReturn } from './snapReturn';
import { setNavHandler } from '../core/runtime/nav';
import { initMusicService } from '../core/runtime/music';
import { initLocationAutoService } from '../core/runtime/locationAuto';
import { initDataShareService } from '../core/runtime/dataShare';
import { restoreAutostartServices } from '../core/runtime/store';
import { registerAutoSyncService } from '../core/sync/auto';
import { HeadStatus } from './runtime/HeadStatus';
import { ServicesPage } from './runtime/ServicesPage';
import { TasksPage } from './runtime/TasksPage';
import type { TabKey } from './icons';
import type { SettingsKey } from './settings/sections';
import { parentOf } from './settings/sections';
import { ackBackHandled, askShellFinish, closeTopLayer, onShellBackPressed } from './back';

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
  | { k: 'settings' }
  | { k: 'services' }
  | { k: 'tasks' };

export default function App() {
  const v = useVersion();
  const privacy = usePrivacyMode();
  const [view, setView] = useState<View>({ k: 'list', s: 'persons' });
  // 带「从成果详情跳出来看过对象」的来路时，自动落到 AI 对话子页
  const [settingsSub, setSettingsSub] = useState<SettingsKey | null>(() =>
    peekSnapReturn() ? 'labAi' : null,
  );
  /** 从服务/任务页返回时回到来之前那一页 */
  const returnView = useRef<View>({ k: 'list', s: 'persons' });
  const [personId, setPersonId] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<TimelineFilter>(defaultFilter);
  const [quickEvent, setQuickEvent] = useState(false);
  /** 从别处（文件库的引用列表）点进来要打开的事件 */
  const [jumpEventId, setJumpEventId] = useState<string | null>(null);
  // 事件已经打开过就把它清掉；固定引用，免得 Timeline 的 effect 每次渲染都重跑
  const onJumpOpened = useCallback(() => setJumpEventId(null), []);

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

  // AI 成果里点事件集结果 → 切到事件集并打开它的详情
  useEffect(() => {
    setCollectionOpener((id) => {
      setCollectionId(id);
      setView({ k: 'detail', s: 'collections', id });
    });
    return () => setCollectionOpener(null);
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
    view.k === 'timeline' || view.k === 'calendar'
      ? view.k
      : view.k === 'settings' || view.k === 'services' || view.k === 'tasks'
        ? (view.k as TabKey)
        : view.s;

  // 全局导航处理器：head 状态图标、服务/任务页都通过它切换页面
  useEffect(() => {
    setNavHandler((t) => {
      if (t.type === 'page') {
        returnView.current = view;
        setView({ k: t.key });
      } else {
        setSettingsSub(t.key as SettingsKey);
        setView({ k: 'settings' });
      }
    });
    return () => setNavHandler(null);
  }, [view]);

  // 开软件时：先让各服务注册（背景音乐 / 自动打点 / 坚果云自动同步），再统一检查存档里
  // 开了自启动的服务把它们拉起来——「刷新后服务不丢」靠的就是这一步。
  // 服务要自启动，只管在 registerService 时交出启动函数，不用自己碰存档。
  useEffect(() => {
    initMusicService();
    initLocationAutoService();
    registerAutoSyncService();
    // 壳端「跨设备操作」：先注册（交出启动函数），restoreAutostartServices 才能点名恢复
    initDataShareService();
    restoreAutostartServices();
  }, []);

  const gotoTab = (key: TabKey) => {
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
    // 从 AI 成果详情点某个对象跳进来的：返回键应该回到那份成果，
    // 而不是把人丢回列表页——否则用户看完对象就再也回不去成果了。
    if (peekSnapReturn()) {
      setView({ k: 'settings' });
      return;
    }
    setView({ k: 'list', s: view.k === 'detail' ? view.s : 'persons' });
  }, [view]);

  /** 归档某人后：退回列表，并把选中顺延到下一位（宽屏右侧也随之换人） */
  const onPersonArchived = useCallback((nextId: string | null) => {
    setPersonId(nextId);
    setView({ k: 'list', s: 'persons' });
  }, []);

  /**
   * 安卓壳的系统返回键（ui.backPressed）：浮层 → 详情 → 服务/任务 → 设置子页 →
   * 按天看的时间线，退无可退才让壳退出应用。
   * 顺序和页面上的返回按钮一致，用户不用记两套。
   */
  const handleShellBack = useCallback(() => {
    if (closeTopLayer()) {
      // 弹窗自己关了：回执告诉壳「这一下已经用掉」，别让它 3 秒后兜底再退
      ackBackHandled();
      return;
    }
    if (view.k === 'detail') {
      backToList();
      ackBackHandled();
      return;
    }
    if (view.k === 'services' || view.k === 'tasks') {
      setView(returnView.current);
      ackBackHandled();
      return;
    }
    if (view.k === 'settings' && settingsSub !== null) {
      setSettingsSub(parentOf(settingsSub) ?? null);
      ackBackHandled();
      return;
    }
    if (view.k === 'timeline' && filter.dayLabel) {
      // 「只看某天」是从日历点进来的，退回日历而不是退回时间线全量
      setKeyword('');
      setFilter(defaultFilter);
      setView({ k: 'calendar' });
      ackBackHandled();
      return;
    }
    askShellFinish();
  }, [view, settingsSub, filter, backToList]);

  // 壳的事件监听是 window 级的，只订阅一次；处理器用 ref 走最新闭包
  const shellBackRef = useRef(handleShellBack);
  useEffect(() => {
    shellBackRef.current = handleShellBack;
  });
  useEffect(() => onShellBackPressed(() => shellBackRef.current()), []);

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

      <RemoteStatusBar />
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
            <PageHead title="时间线" right={<HeadStatus />} />
            <TimelineFilters filter={filter} onChange={setFilter} />
            <Timeline
              filter={filter}
              keyword={keyword}
              openId={jumpEventId}
              onOpened={onJumpOpened}
              onClearDay={() => setFilter(defaultFilter)}
              onBackToCalendar={() => setView({ k: 'calendar' })}
            />
          </div>
        )}
        {view.k === 'calendar' && (
          <div className="pane pane-solo">
            <PageHead title="日历" right={<HeadStatus />} />
            <Calendar onPickDay={pickDay} />
          </div>
        )}
        {view.k === 'settings' && (
          <div className="pane pane-solo">
            {/* 标题由 Settings 自己渲染：子页要把标题换成该设置项的名字 */}
            <Settings sub={settingsSub} onSub={setSettingsSub} />
          </div>
        )}
        {view.k === 'services' && (
          <ServicesPage onBack={() => setView(returnView.current)} />
        )}
        {view.k === 'tasks' && (
          <TasksPage onBack={() => setView(returnView.current)} />
        )}
      </div>

      <TabBar section={section} onTab={gotoTab} />

      <UndoSnackbar />
      <ToastHost />

      {/* 设置 / 服务 / 任务页没有「记一件事」的语境，按钮只会挡住内容，直接不渲染 */}
      {modalCount === 0 && !['settings', 'services', 'tasks'].includes(section) && (
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
