// 月视图日历：连续竖向滚动的多个月份，当前月初始居中，上下滑可看其它月份。
//
// 配色只有三种状态，用户不用记任何图例：
//   过去 —— 灰底，读作「已经发生」
//   今天 —— 黄底，一眼定位
//   将来 —— 白底
//
// 事件一律画成「横条」：
//   · 跨天事件跨几列就占几列（起点/终点被月边界裁掉时画 ◀▶ 延续箭头）；
//   · 单日事件只占一格（与日期框同宽、留背景），外观与跨天条一致，复用同一套框架；
//   · 横条内容超宽时自动跑马灯滚动。
// 日期框本身只显示日期数字 + 有记录时的小红点，不放事件内容。
//
// 排布：整段月份展平成一条条「周」首尾相接地流下去（不重复、不补空白）。
// 月初就直接接在月末后面（例如 28 29 30 1 2 3 4 在同一行），
// 月边界只插一条轻量的「10 月」标签做标尺，不再用块标题把周断开。
// 点标题里的年 / 月打开选择器可跳转到任意月份并居中；点某一天回时间线按那天过滤。
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  buildMonthGrid,
  collectDaySummaries,
  collectMonthCounts,
  collectSpanBars,
  dayKeyOf,
  monthKey,
  monthOf,
  shiftMonth,
  todayKey,
  WEEKDAY_LABELS,
  EMPTY_CALENDAR_FILTER,
  type CalendarFilter,
  type DayCell,
  type DayKey,
  type MonthRef,
  type SpanBar,
} from '../../core/calendar';
import { useVersion } from '../../store';
import { Modal } from '../common';
import { CollectionIconView, defaultTextIcon } from '../collections/CollectionIcon';

/** 初始窗口：当前月上下各留几个月的余量，滚动时再按需扩展 */
const WINDOW = 3;
/** 触发加载相邻月份的滚动边距（px） */
const EDGE = 320;
/** 每次触边预加载的月份数 */
const PREPEND = 3;
const APPEND = 3;
/** 滚动能到达的最早 / 最晚月份，避免无限增长 */
const FLOOR_YEAR = 1990;
const CEIL_YEAR = 2100;

/**
 * 离开日历页时记下的视图状态。
 *
 * 切到时间线时日历组件会整个卸载，内部状态全丢——翻到 8 月点某一天进去看时间线，
 * 再点「日历」页签就被重置回今天，之前翻的位置全白费。
 * 所以把「月份窗口 / 居中月份 / 定位锚点 / 滚动位置」存在模块级变量里，
 * 下次挂载时原样还原（只在该标签页会话内保留，刷新页面才算真正重置）。
 */
interface CalendarViewState {
  months: MonthRef[];
  center: MonthRef;
  focusedDay: DayKey;
  scrollTop: number;
}
let savedView: CalendarViewState | null = null;

function buildWindow(center: MonthRef): MonthRef[] {
  const out: MonthRef[] = [];
  for (let i = -WINDOW; i <= WINDOW; i += 1) out.push(shiftMonth(center, i));
  return out;
}

/** 把新月份并入已有列表，同月的重复项直接丢掉（防重入的第二遍落空） */
function mergeMonths(add: MonthRef[], base: MonthRef[]): MonthRef[] {
  const have = new Set(base.map(monthKey));
  return [...add.filter((m) => !have.has(monthKey(m))), ...base];
}

/** 日键 +N 天（本地零点推进，避开 toISOString 的时区穿越） */
function addDays(key: DayKey, n: number): DayKey {
  const [y, m, d] = key.split('-').map(Number);
  return dayKeyOf(new Date(y, m - 1, d + n));
}

/** 日键 → 所属月份（0 起） */
function monthOfKey(key: DayKey): MonthRef {
  const [y, m] = key.split('-').map(Number);
  return { year: y, month: m - 1 };
}

interface WeekRow {
  /** 周一起始日的日键（周一为每周第一列） */
  key: string;
  /** 7 个连续日期格 */
  cells: DayCell[];
  /** 该周是否为某个月份的第一周（用于挂居中/跳转定位的 ref） */
  marker: boolean;
}

/**
 * 把一段月份展平成「连续周流」：从第一个月网格的首个周一开始，
 * 每 7 天一条周，一路连到最后一月网格的最后一个周日。
 * 相邻月份的边界周只出现一次（首尾相接、不重复），所以 28 29 30 | 1 2 3 4
 * 落在同一行，月初直接接在月末后面，不会被空白或分隔线断开。
 * 月份归属交给顶部常驻标题实时指示，周流里不再插月份标签/横线。
 */
function buildWeeks(months: MonthRef[], today: DayKey): WeekRow[] {
  if (months.length === 0) return [];
  const monthsSet = new Set(months.map(monthKey));
  const firstGrid = buildMonthGrid(months[0], today);
  const lastGrid = buildMonthGrid(months[months.length - 1], today);
  const start = firstGrid[0].key;
  const end = lastGrid[lastGrid.length - 1].key;

  const weeks: WeekRow[] = [];
  let cur = start;
  let first = true;
  while (cur <= end) {
    const cells: DayCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      const k = addDays(cur, i);
      const [y, m, d] = k.split('-').map(Number);
      const inWin = monthsSet.has(monthKey({ year: y, month: m - 1 }));
      cells.push({
        key: k,
        day: d,
        inMonth: inWin,
        phase: k === today ? 'today' : k < today ? 'past' : 'future',
      });
    }
    // 首周（窗口起始月）与每月 1 号所在的那一周都算「月份第一周」，留给 ref
    const marker = first || cells.some((c) => c.inMonth && c.day === 1);
    weeks.push({ key: cur, cells, marker });
    cur = addDays(cur, 7);
    first = false;
  }
  return weeks;
}

/** 跳过去之后让那一格闪一下，用户才知道落点在哪 */
function flashDay(el: HTMLElement): void {
  el.classList.remove('cal-cell-flash');
  // 读一次布局强制重排，否则连续点同一个目标时动画不会重播
  void el.offsetWidth;
  el.classList.add('cal-cell-flash');
  window.setTimeout(() => el.classList.remove('cal-cell-flash'), 1200);
}

/**
 * 把某一天滚到滚动容器正中。
 * 日期格都带 data-day="YYYY-MM-DD"，直接查 DOM 就能定位，
 * 不用再去算它属于第几周第几列。找不到（那一月还没渲染）返回 false。
 */
function centerDay(cont: HTMLElement, key: DayKey): boolean {
  const el = cont.querySelector<HTMLElement>(`[data-day="${key}"]`);
  if (!el) return false;
  cont.scrollTop = el.offsetTop - (cont.clientHeight - el.clientHeight) / 2;
  flashDay(el);
  return true;
}

export function MonthView({
  onPickDay,
  filter = EMPTY_CALENDAR_FILTER,
}: {
  onPickDay: (key: string) => void;
  filter?: CalendarFilter;
}) {
  const v = useVersion();
  const today = todayKey();
  // 当前真实月份：整次会话固定在打开时，跨零点也不跳变
  const current = useMemo(() => monthOf(new Date()), []);
  // 有上次的痕迹就接着上次的看，没有才从当前月开始
  const [months, setMonths] = useState<MonthRef[]>(() => savedView?.months ?? buildWindow(current));
  const [center, setCenter] = useState<MonthRef>(() => savedView?.center ?? current);
  const [picker, setPicker] = useState<'month' | 'year' | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const monthRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingScroll = useRef<string | null>(savedView ? null : monthKey(current));
  /** 上次离开时的滚动位置，挂载后原样还原 */
  const pendingScrollTop = useRef<number | null>(savedView ? savedView.scrollTop : null);
  const pendingPrepend = useRef(0);
  const prevHeight = useRef(0);
  /** 触边续接的进行中标记，防止一次滚动重复追加 */
  const edgeLoading = useRef(false);
  /** 待定位到的「具体某一天」：月份还没加载时先记住，等窗口扩展后再滚 */
  const pendingScrollDay = useRef<DayKey | null>(null);
  /** 当前所在（或上次跳转到的）有事件日子，作为「上一日 / 下一日」的锚点 */
  const [focusedDay, setFocusedDay] = useState<DayKey>(() => savedView?.focusedDay ?? today);

  const summaries = useMemo(() => collectDaySummaries(filter), [v, filter]);
  // 全部有事件的日子（全局、不限于当前窗口），按日键升序排好，供快速跳转
  const eventDays = useMemo(() => Array.from(summaries.keys()).sort(), [summaries]);
  const monthCounts = useMemo(() => collectMonthCounts(filter), [v, filter]);
  const barsByMonth = useMemo(() => {
    const map = new Map<string, SpanBar[]>();
    for (const m of months) map.set(monthKey(m), collectSpanBars(m, filter));
    return map;
  }, [months, v, filter]);

  const weeks = useMemo(() => buildWeeks(months, today), [months, today]);

  // 把某个月整体滚到容器正中：用「下月首周 - 本月首周」的高度当整月高度，
  // 既让月初露在靠上位置、又不会把今天顶到屏幕外（比只居中首周准确）。
  const centerMonth = (cont: HTMLDivElement, m: MonthRef) => {
    const el = monthRefs.current.get(monthKey(m));
    if (!el) return false;
    const nextEl = monthRefs.current.get(monthKey(shiftMonth(m, 1)));
    const height = nextEl ? nextEl.offsetTop - el.offsetTop : cont.clientHeight;
    cont.scrollTop = el.offsetTop - Math.max(0, (cont.clientHeight - height) / 2);
    return true;
  };

  // 让某个月滚动到容器正中（跳转换月 / 回今天 / 初始定位都用它）
  const scrollToMonth = (m: MonthRef) => {
    const key = monthKey(m);
    pendingScroll.current = key;
    const cont = scrollRef.current;
    const el = monthRefs.current.get(key);
    if (cont && el) {
      // 目标已在列表里（最常见：回今天）时，setMonths 会拿回同一引用，
      // React 直接跳过重渲染，useLayoutEffect 不会跑 —— 这里直接定位。
      requestAnimationFrame(() => {
        const c = scrollRef.current;
        if (c && centerMonth(c, m)) pendingScroll.current = null;
      });
    } else {
      // 目标还没加载：交给 useLayoutEffect 在列表扩展后定位
      setMonths((ms) => (ms.some((x) => x.year === m.year && x.month === m.month) ? ms : buildWindow(m)));
    }
  };

  /**
   * 定位到具体的某一天（快速跳到有事件的日子时用）。
   * 目标月份已经在窗口里就立刻滚；还没加载就先把窗口挪过去，
   * 由 useLayoutEffect 在窗口扩展后补一次定位。
   */
  const scrollToDay = (key: DayKey) => {
    setFocusedDay(key);
    pendingScrollDay.current = key;
    const m = monthOfKey(key);
    const present = months.some((x) => x.year === m.year && x.month === m.month);
    if (!present) {
      setMonths((ms) =>
        ms.some((x) => x.year === m.year && x.month === m.month) ? ms : buildWindow(m),
      );
      return;
    }
    requestAnimationFrame(() => {
      const c = scrollRef.current;
      if (c && centerDay(c, key)) pendingScrollDay.current = null;
    });
  };

  /** 全部有事件的日子里，往前 / 往后各推一格；没有就按兵不动 */
  const gotoPrevDay = () => {
    for (let i = eventDays.length - 1; i >= 0; i -= 1) {
      if (eventDays[i] < focusedDay) {
        scrollToDay(eventDays[i]);
        return;
      }
    }
  };

  const gotoNextDay = () => {
    const next = eventDays.find((k) => k > focusedDay);
    if (next) scrollToDay(next);
  };

  // 周渲染后，处理「顶部续接」的滚动补偿 + 居中跳转
  useLayoutEffect(() => {
    const cont = scrollRef.current;
    // 新月份已经渲染完，放开闸门；这一步必须在读取 scrollHeight 之前，
    // 否则紧接着的 scroll 事件会被挡住、续接卡住
    edgeLoading.current = false;
    if (!cont) return;
    if (pendingPrepend.current > 0) {
      const delta = cont.scrollHeight - prevHeight.current;
      cont.scrollTop += delta;
      pendingPrepend.current = 0;
    }
    // 回到日历页：先把滚动位置还原到上次离开的地方（此时已有上次的月份窗口，
    // 内容高度一致，scrollTop 才落得准）；没有历史时才走下面的居中逻辑。
    if (pendingScrollTop.current !== null) {
      cont.scrollTop = pendingScrollTop.current;
      pendingScrollTop.current = null;
    }
    if (pendingScroll.current) {
      const target = months.find((x) => monthKey(x) === pendingScroll.current);
      if (target && centerMonth(cont, target)) pendingScroll.current = null;
    }
    // 跳到具体某一天：窗口刚扩展完、DOM 里才有那一天
    if (pendingScrollDay.current && centerDay(cont, pendingScrollDay.current)) {
      pendingScrollDay.current = null;
    }
  }, [months]);

  const registerMonthRef = (m: MonthRef) => (el: HTMLDivElement | null) => {
    if (el) monthRefs.current.set(monthKey(m), el);
    else monthRefs.current.delete(monthKey(m));
  };

  // 找出最靠近视口垂直中线的月份，用它驱动顶部标题
  const recalcCenter = () => {
    const cont = scrollRef.current;
    if (!cont) return;
    const cY = cont.getBoundingClientRect().top + cont.clientHeight / 2;
    let best: MonthRef | null = null;
    let bestD = Infinity;
    for (const m of months) {
      const el = monthRefs.current.get(monthKey(m));
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - cY);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    const b = best as MonthRef | null;
    if (b) setCenter((prev) => (b.year !== prev.year || b.month !== prev.month ? b : prev));
  };

  /** 把当前视图状态记下来，下次进日历页照着还原 */
  const persistView = (focus?: DayKey) => {
    savedView = {
      months,
      center,
      focusedDay: focus ?? focusedDay,
      scrollTop: scrollRef.current?.scrollTop ?? 0,
    };
  };

  // 月份窗口 / 居中月份 / 定位锚点变了就同步一次
  useEffect(() => {
    persistView();
    // persistView 每次渲染都是新的，不进依赖，否则会无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, center, focusedDay]);

  const onScroll = () => {
    const cont = scrollRef.current;
    if (!cont) return;
    const top = cont.scrollTop;
    const bottom = cont.scrollHeight - cont.scrollTop - cont.clientHeight;

    // 1) 触边续接相邻月份。
    // edgeLoading 是防重入的闸门：一次滚动会连发好几个 scroll 事件，
    // 而 setMonths 提交前 months 还是旧值——没有它就会连续追加两遍，
    // 于是「补偿量」被算两次、内容却只长了一次，画面直接漂走（8 月漂到 11 月）。
    if (top < EDGE && !edgeLoading.current) {
      const head = months[0];
      if (!(head.year <= FLOOR_YEAR && head.month === 0)) {
        const prev: MonthRef[] = [];
        for (let i = PREPEND; i >= 1; i -= 1) prev.push(shiftMonth(head, -i));
        edgeLoading.current = true;
        prevHeight.current = cont.scrollHeight;
        pendingPrepend.current = prev.length;
        setMonths((ms) => mergeMonths(prev, ms));
      }
    } else if (bottom < EDGE && !edgeLoading.current) {
      const tail = months[months.length - 1];
      if (!(tail.year >= CEIL_YEAR && tail.month === 11)) {
        const add: MonthRef[] = [];
        for (let i = 1; i <= APPEND; i += 1) add.push(shiftMonth(tail, i));
        edgeLoading.current = true;
        setMonths((ms) => mergeMonths(ms, add));
      }
    }

    // 2) 跟踪居中月份（驱动标题）
    recalcCenter();

    // 3) 记住滚动位置：离开日历页再回来要落在同一处
    persistView();
  };

  // 窗口尺寸 / 屏幕旋转后重新判定居中月份，避免标题与实际显示不符
  useEffect(() => {
    const onResize = () => recalcCenter();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
    // recalcCenter 依赖 months，月份列表变化时重新绑定即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months]);

  const centerMonthCount = monthCounts.get(monthKey(center)) ?? 0;
  const centerPrefix = `${center.year}-${String(center.month + 1).padStart(2, '0')}`;
  const centerCellCount = useMemo(() => {
    let n = 0;
    for (const k of summaries.keys()) if (k.startsWith(centerPrefix)) n += 1;
    return n;
  }, [summaries, centerPrefix]);
  const isCurrentCentered = center.year === current.year && center.month === current.month;

  // 年份列表覆盖「有记录的年份」，并在当前年 / 正在看的年两边各留 5 年
  const years = useMemo(() => {
    let min = Math.min(center.year, Number(today.slice(0, 4))) - 5;
    let max = Math.max(center.year, Number(today.slice(0, 4))) + 5;
    for (const key of monthCounts.keys()) {
      const y = Number(key.slice(0, 4));
      if (y < min) min = y;
      if (y > max) max = y;
    }
    const out: number[] = [];
    for (let y = min; y <= max; y += 1) out.push(y);
    return out;
  }, [monthCounts, center.year, today]);

  const countOfYear = (year: number) => {
    let n = 0;
    for (let m = 0; m < 12; m += 1) n += monthCounts.get(monthKey({ year, month: m })) ?? 0;
    return n;
  };

  // 快速跳转的可用状态：一条事件都没有时四个按钮全灰；
  // 已经站在最早 / 最晚那天时，对应的「上一日 / 下一日」也灰掉，点了不会有反应。
  const firstEventDay = eventDays.length > 0 ? eventDays[0] : null;
  const lastEventDay = eventDays.length > 0 ? eventDays[eventDays.length - 1] : null;
  const hasPrevDay = eventDays.some((k) => k < focusedDay);
  const hasNextDay = eventDays.some((k) => k > focusedDay);

  // 点某一天：除了回时间线，也把它记成「上一日 / 下一日」的锚点。
  // 这里必须同步存一份——onPickDay 会立刻切走页面、组件随即卸载，
  // 上面那个 effect 根本来不及带着新的 focusedDay 跑一遍。
  const handlePick = (key: DayKey) => {
    setFocusedDay(key);
    persistView(key);
    onPickDay(key);
  };

  // 取某周涉及的两个月份的横条（跨月周会把两端月份各裁一段，拼起来正好覆盖整周）
  const barsForWeek = (w: WeekRow): SpanBar[] => {
    const ka = monthKey(monthOfKey(w.cells[0].key));
    const kb = monthKey(monthOfKey(w.cells[6].key));
    const a = barsByMonth.get(ka) ?? [];
    if (ka === kb) return a;
    return [...a, ...(barsByMonth.get(kb) ?? [])];
  };

  return (
    <div className="cal">
      <div className="cal-head">
        <div className="cal-title">
          <div className="cal-title-row">
            <button className="cal-title-btn" onClick={() => setPicker('year')} title="选择年份">
              {center.year} 年
            </button>
            <button className="cal-title-btn" onClick={() => setPicker('month')} title="选择月份">
              {center.month + 1} 月
            </button>
          </div>
          <span className="muted small">
            {centerMonthCount} 件事 · {centerCellCount} 天有记录
          </span>
        </div>
        <div className="cal-head-actions">
          {!isCurrentCentered && (
            <button className="btn btn-sm" onClick={() => scrollToMonth(current)}>
              回今天
            </button>
          )}
        </div>
      </div>

      {/* 四个快速定位：不用在空日子里翻来翻去，直接落到有事件的那天 */}
      <div className="cal-jump">
        <button
          className="cal-jump-btn"
          disabled={!firstEventDay}
          onClick={() => firstEventDay && scrollToDay(firstEventDay)}
          title="跳到最早有记录的那一天"
        >
          最早
        </button>
        <button
          className="cal-jump-btn"
          disabled={!hasPrevDay}
          onClick={gotoPrevDay}
          title="跳到前一日有记录的日子"
        >
          上一日
        </button>
        <button
          className="cal-jump-btn"
          disabled={!hasNextDay}
          onClick={gotoNextDay}
          title="跳到下一日有记录的日子"
        >
          下一日
        </button>
        <button
          className="cal-jump-btn"
          disabled={!lastEventDay}
          onClick={() => lastEventDay && scrollToDay(lastEventDay)}
          title="跳到最晚有记录的那一天"
        >
          最晚
        </button>
      </div>

      <div className="cal-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="cal-weekdays" aria-hidden>
          {WEEKDAY_LABELS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        {weeks.map((w, idx) => {
          // 只有标记周（每月首周）才需要挂一个 ref 供居中/跳转定位；
          // 其余周不计算月份，避免在非标记周上取到 undefined。
          let refCb: ((el: HTMLDivElement | null) => void) | undefined;
          if (w.marker) {
            const mk =
              idx === 0
                ? months[0]
                : monthOfKey(w.cells.find((c) => c.inMonth && c.day === 1)!.key);
            refCb = registerMonthRef(mk);
          }
          return (
            <div className="cal-week" key={w.key} ref={refCb}>
              {w.cells.map((cell) => (
                <DayCellView
                  key={cell.key}
                  cell={cell}
                  hasEvents={summaries.has(cell.key)}
                  onPick={() => handlePick(cell.key)}
                />
              ))}
              {weekSegments(w.cells, barsForWeek(w)).map((seg) => (
                <SpanBarView
                  key={`${seg.bar.eventId}-${seg.key}`}
                  seg={seg}
                  onPick={() => handlePick(seg.key)}
                />
              ))}
            </div>
          );
        })}
      </div>

      {picker === 'month' && (
        <Modal
          title={`${center.year} 年，选择月份`}
          onClose={() => setPicker(null)}
        >
          <div className="cal-pick-grid">
            {Array.from({ length: 12 }, (_, mm) => {
              const key = monthKey({ year: center.year, month: mm });
              const count = monthCounts.get(key) ?? 0;
              const on = mm === center.month;
              return (
                <button
                  key={key}
                  className={on ? 'cal-pick cal-pick-on' : 'cal-pick'}
                  onClick={() => {
                    scrollToMonth({ year: center.year, month: mm });
                    setPicker(null);
                  }}
                >
                  <strong>{mm + 1} 月</strong>
                  <span>{count > 0 ? `${count} 件` : '没有记录'}</span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}

      {picker === 'year' && (
        <Modal title="选择年份" onClose={() => setPicker(null)}>
          <div className="cal-year-list">
            {years.map((y) => {
              const count = countOfYear(y);
              return (
                <button
                  key={y}
                  className={y === center.year ? 'cal-year-row cal-year-row-on' : 'cal-year-row'}
                  onClick={() => {
                    scrollToMonth({ year: y, month: center.month });
                    setPicker(null);
                  }}
                >
                  <strong>{y} 年</strong>
                  <span>{count > 0 ? `${count} 件` : '没有记录'}</span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}

function DayCellView({
  cell,
  hasEvents,
  onPick,
}: {
  cell: DayCell;
  hasEvents: boolean;
  onPick: () => void;
}) {
  // 窗口之外的邻月补位（比如整段月份最顶上的 8 月底、最底下的 11 月初）：
  // 照常显示日期数字、压淡处理，保持 7 列对齐；不作空白占位，避免把周断开。
  // 窗口内部的跨月周（如 28 29 30 | 1 2 3 4）里两个月的日期都是 inMonth，正常显示，
  // 所以月初直接接在月末后面，中间没有任何断点。
  const cls = cell.inMonth ? `cal-cell cal-${cell.phase}` : 'cal-cell cal-out';
  // 每月 1 号顺手把月份标在日期前面（7.1 / 12.1）：
  // 月份部分压到极小、只占约一个正常数字的宽度，日期数字本身保持原大小，
  // 这样连续周流里就有了月份标尺，又不会把窄格子撑爆。
  const monthTag = cell.day === 1 ? Number(cell.key.slice(5, 7)) : null;
  return (
    <button
      type="button"
      className={cls}
      onClick={onPick}
      title={cell.key}
      data-day={cell.key}
    >
      <span className="cal-date">
        {monthTag !== null && <span className="cal-mtag">{monthTag}.</span>}
        {cell.day}
      </span>
      {hasEvents && <span className="cal-dot" />}
    </button>
  );
}

/**
 * 横条里的「图标 + 标题」：放得下就静止，放不下就复制一份向左匀速滚动。
 * 单日 / 跨日事件都用它，外观统一。
 */
function Marquee({ children }: { children: ReactNode }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const [running, setRunning] = useState(false);
  const [duration, setDuration] = useState(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const track = trackRef.current;
    if (!box || !track) return;

    const measure = () => {
      // 滚动时内容复制了一份，一半就是真实内容宽度
      const content = running ? track.scrollWidth / 2 : track.scrollWidth;
      const over = content > box.clientWidth + 1;
      setRunning(over);
      if (over) setDuration(Math.max(4, Math.round(content / 14)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    ro.observe(track);
    return () => ro.disconnect();
  }, [running]);

  return (
    <span className={running ? 'cal-events cal-events-run' : 'cal-events'} ref={boxRef}>
      <span
        className="cal-ticker"
        ref={trackRef}
        style={running ? { animationDuration: `${duration}s` } : undefined}
      >
        <span className="cal-ticker-copy">{children}</span>
        {running && <span className="cal-ticker-copy">{children}</span>}
      </span>
    </span>
  );
}

function BarLabel({ bar }: { bar: SpanBar }) {
  return (
    <Marquee>
      {bar.icon && <CollectionIconView icon={bar.icon} size="sm" fallback={bar.title} />}
      <span className="cal-ev-title">{bar.title}</span>
    </Marquee>
  );
}

interface WeekSegment {
  bar: SpanBar;
  /** 在本周的列（0–6） */
  colStart: number;
  colEnd: number;
  /** 段首那天的日键，点击条就跳这一天 */
  key: string;
  clippedStart: boolean;
  clippedEnd: boolean;
  /** 落到的行（0 起）；同一事件被月边界裁成的两段会强制同一行，跨周才断开 */
  row: number;
}

/** 把跨天条裁进某一周：跨周的事件每周各画一段，段与段首尾相接 */
function weekSegments(week: DayCell[], bars: SpanBar[]): WeekSegment[] {
  const wkStart = week[0].key;
  const wkEnd = week[6].key;
  const segs: WeekSegment[] = [];
  for (const bar of bars) {
    if (bar.endKey < wkStart || bar.startKey > wkEnd) continue;
    const keyStart = bar.startKey < wkStart ? wkStart : bar.startKey;
    const keyEnd = bar.endKey > wkEnd ? wkEnd : bar.endKey;
    const colStart = week.findIndex((c) => c.key === keyStart);
    const colEnd = week.findIndex((c) => c.key === keyEnd);
    if (colStart < 0 || colEnd < 0) continue;
    segs.push({
      bar,
      colStart,
      colEnd,
      key: keyStart,
      clippedStart: bar.clippedStart || bar.startKey < wkStart,
      clippedEnd: bar.clippedEnd || bar.endKey > wkEnd,
      row: bar.lane,
    });
  }

  // 同一条事件可能被月边界裁成两段（9 月末一段 + 10 月初一段）塞进同一周，
  // 它们本是一根连续的条：这里合并成一段，中间就不会冒出 ▶◀ 的假断点；
  // 合并时顺便把行号取较小值，确保它不会错行。
  const byEvent = new Map<string, WeekSegment>();
  for (const s of segs) {
    const prev = byEvent.get(s.bar.eventId);
    if (!prev) {
      byEvent.set(s.bar.eventId, s);
      continue;
    }
    const leftFirst = prev.colStart <= s.colStart;
    byEvent.set(s.bar.eventId, {
      bar: prev.bar,
      colStart: Math.min(prev.colStart, s.colStart),
      colEnd: Math.max(prev.colEnd, s.colEnd),
      key: leftFirst ? prev.key : s.key,
      clippedStart: leftFirst ? prev.clippedStart : s.clippedStart,
      clippedEnd: prev.colEnd >= s.colEnd ? prev.clippedEnd : s.clippedEnd,
      row: Math.min(prev.row, s.row),
    });
  }

  // 行号由 row 决定，跨周的条能停在同一行；同 row 的按列序兜底
  return [...byEvent.values()].sort((a, b) => a.row - b.row || a.colStart - b.colStart);
}

function SpanBarView({ seg, onPick }: { seg: WeekSegment; onPick: () => void }) {
  const { bar } = seg;
  const range = bar.startKey === bar.endKey ? bar.startKey : `${bar.startKey} → ${bar.endKey}`;
  // 底色跟事件集走：有自定义图标就用它的「浅底 + 同色系深字」配色；
  // 没设图标则按集合名取默认散列色（和集合头像同一套）；连集合都没有才用主题色。
  const auto = bar.toneSeed ? defaultTextIcon(bar.toneSeed) : null;
  const bg = bar.icon?.bg ?? auto?.bg;
  const fg = bar.icon?.fg ?? auto?.fg;
  const tone = bg ? { background: bg, color: fg ?? 'var(--text)' } : undefined;
  return (
    <button
      type="button"
      className="cal-span"
      style={{ gridRow: seg.row + 2, gridColumn: `${seg.colStart + 1} / ${seg.colEnd + 2}`, ...tone }}
      onClick={onPick}
      title={`${bar.title}（${range}）`}
    >
      {seg.clippedStart && <span className="cal-span-clip">◀</span>}
      <BarLabel bar={bar} />
      {seg.clippedEnd && <span className="cal-span-clip">▶</span>}
    </button>
  );
}
