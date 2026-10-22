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
import { CollectionIconView } from '../collections/CollectionIcon';

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

function buildWindow(center: MonthRef): MonthRef[] {
  const out: MonthRef[] = [];
  for (let i = -WINDOW; i <= WINDOW; i += 1) out.push(shiftMonth(center, i));
  return out;
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
  const [months, setMonths] = useState<MonthRef[]>(() => buildWindow(current));
  const [center, setCenter] = useState<MonthRef>(current);
  const [picker, setPicker] = useState<'month' | 'year' | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const monthRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingScroll = useRef<string | null>(monthKey(current));
  const pendingPrepend = useRef(0);
  const prevHeight = useRef(0);

  const summaries = useMemo(() => collectDaySummaries(filter), [v, filter]);
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

  // 周渲染后，处理「顶部续接」的滚动补偿 + 居中跳转
  useLayoutEffect(() => {
    const cont = scrollRef.current;
    if (!cont) return;
    if (pendingPrepend.current > 0) {
      const delta = cont.scrollHeight - prevHeight.current;
      cont.scrollTop += delta;
      pendingPrepend.current = 0;
    }
    if (pendingScroll.current) {
      const target = months.find((x) => monthKey(x) === pendingScroll.current);
      if (target && centerMonth(cont, target)) pendingScroll.current = null;
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

  const onScroll = () => {
    const cont = scrollRef.current;
    if (!cont) return;
    const top = cont.scrollTop;
    const bottom = cont.scrollHeight - cont.scrollTop - cont.clientHeight;

    // 1) 触边续接相邻月份
    if (top < EDGE) {
      const head = months[0];
      if (!(head.year <= FLOOR_YEAR && head.month === 0)) {
        const prev: MonthRef[] = [];
        for (let i = PREPEND; i >= 1; i -= 1) prev.push(shiftMonth(head, -i));
        prevHeight.current = cont.scrollHeight;
        pendingPrepend.current = prev.length;
        setMonths((ms) => [...prev, ...ms]);
      }
    } else if (bottom < EDGE) {
      const tail = months[months.length - 1];
      if (!(tail.year >= CEIL_YEAR && tail.month === 11)) {
        const add: MonthRef[] = [];
        for (let i = 1; i <= APPEND; i += 1) add.push(shiftMonth(tail, i));
        setMonths((ms) => [...ms, ...add]);
      }
    }

    // 2) 跟踪居中月份（驱动标题）
    recalcCenter();
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
                  onPick={() => onPickDay(cell.key)}
                />
              ))}
              {weekSegments(w.cells, barsForWeek(w)).map((seg) => (
                <SpanBarView
                  key={`${seg.bar.eventId}-${seg.key}`}
                  seg={seg}
                  onPick={() => onPickDay(seg.key)}
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
  return (
    <button
      type="button"
      className={cls}
      onClick={onPick}
      title={cell.key}
      data-day={cell.key}
    >
      <span className="cal-date">{cell.day}</span>
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
  return (
    <button
      type="button"
      className="cal-span"
      style={{ gridRow: seg.row + 2, gridColumn: `${seg.colStart + 1} / ${seg.colEnd + 2}` }}
      onClick={onPick}
      title={`${bar.title}（${range}）`}
    >
      {seg.clippedStart && <span className="cal-span-clip">◀</span>}
      <BarLabel bar={bar} />
      {seg.clippedEnd && <span className="cal-span-clip">▶</span>}
    </button>
  );
}
