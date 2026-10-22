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
// 切换月份：直接上下滚动即可（原生滚动，无限延伸）；
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
  monthOf,
  monthKey,
  shiftMonth,
  todayKey,
  WEEKDAY_LABELS,
  EMPTY_CALENDAR_FILTER,
  type CalendarFilter,
  type DayCell,
  type DaySummary,
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
  const blockRefs = useRef<Map<string, HTMLDivElement>>(new Map());
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

  // 让某个月滚动到容器正中（跳转换月 / 回今天 / 初始定位都用它）
  const scrollToMonth = (m: MonthRef) => {
    const key = monthKey(m);
    pendingScroll.current = key;
    const cont = scrollRef.current;
    const el = blockRefs.current.get(key);
    if (cont && el) {
      // 目标已在列表里（最常见：回今天）时，setMonths 会拿回同一引用，
      // React 直接跳过重渲染，useLayoutEffect 不会跑 —— 这里直接定位。
      requestAnimationFrame(() => {
        const c = scrollRef.current;
        const e = blockRefs.current.get(key);
        if (c && e) {
          c.scrollTop = e.offsetTop - (c.clientHeight - e.clientHeight) / 2;
          pendingScroll.current = null;
        }
      });
    } else {
      // 目标还没加载：交给 useLayoutEffect 在列表扩展后定位
      setMonths((ms) => (ms.some((x) => x.year === m.year && x.month === m.month) ? ms : buildWindow(m)));
    }
  };

  // 月份块渲染后，处理「顶部续接」的滚动补偿 + 居中跳转
  useLayoutEffect(() => {
    const cont = scrollRef.current;
    if (!cont) return;
    if (pendingPrepend.current > 0) {
      const delta = cont.scrollHeight - prevHeight.current;
      cont.scrollTop += delta;
      pendingPrepend.current = 0;
    }
    if (pendingScroll.current) {
      const el = blockRefs.current.get(pendingScroll.current);
      if (el) {
        cont.scrollTop = el.offsetTop - (cont.clientHeight - el.clientHeight) / 2;
        pendingScroll.current = null;
      }
    }
  }, [months]);

  const registerRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) blockRefs.current.set(key, el);
    else blockRefs.current.delete(key);
  };

  // 找出最靠近视口垂直中线的月份，用它驱动顶部标题
  const recalcCenter = () => {
    const cont = scrollRef.current;
    if (!cont) return;
    const cY = cont.getBoundingClientRect().top + cont.clientHeight / 2;
    let best: MonthRef | null = null;
    let bestD = Infinity;
    for (const m of months) {
      const el = blockRefs.current.get(monthKey(m));
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

  const centerGrid = useMemo(() => buildMonthGrid(center, today), [center, today]);
  const centerMonthCount = monthCounts.get(monthKey(center)) ?? 0;
  const centerCellCount = centerGrid.filter((c) => c.inMonth && summaries.has(c.key)).length;
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

        {months.map((m) => (
          <MonthBlock
            key={monthKey(m)}
            month={m}
            today={today}
            summaries={summaries}
            bars={barsByMonth.get(monthKey(m)) ?? []}
            registerRef={registerRef(monthKey(m))}
            onPickDay={onPickDay}
          />
        ))}
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

function MonthBlock({
  month,
  today,
  summaries,
  bars,
  registerRef,
  onPickDay,
}: {
  month: MonthRef;
  today: string;
  summaries: Map<string, DaySummary>;
  bars: SpanBar[];
  registerRef: (el: HTMLDivElement | null) => void;
  onPickDay: (key: string) => void;
}) {
  const grid = useMemo(() => buildMonthGrid(month, today), [month, today]);
  const weeks = useMemo(() => {
    const out: DayCell[][] = [];
    for (let i = 0; i < grid.length; i += 7) out.push(grid.slice(i, i + 7));
    return out;
  }, [grid]);

  return (
    <section className="cal-block" ref={registerRef}>
      <div className="cal-block-head">
        <span className="cal-block-title">
          {month.month === 0 ? `${month.year} 年 ` : ''}
          {month.month + 1} 月
        </span>
      </div>
      <div className="cal-grid" role="grid">
        {weeks.map((week) => (
          <div className="cal-week" key={week[0].key}>
            {week.map((cell) => (
              <DayCellView
                key={cell.key}
                cell={cell}
                hasEvents={summaries.has(cell.key)}
                onPick={() => onPickDay(cell.key)}
              />
            ))}
            {weekSegments(week, bars).map((seg) => (
              <SpanBarView key={`${seg.bar.eventId}-${week[0].key}`} seg={seg} onPick={() => onPickDay(seg.key)} />
            ))}
          </div>
        ))}
      </div>
    </section>
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
  // 非本月：留空白占位（保持 7 列对齐），不显示邻居月份的数字，也不响应点击。
  // 这样「跨月那一周」就不会被拆成两半、分别塞进两个月份块里。
  if (!cell.inMonth) {
    return <div className="cal-cell cal-out" aria-hidden />;
  }
  return (
    <button
      type="button"
      className={`cal-cell cal-${cell.phase}`}
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
    });
  }
  // 行号由 lane 决定，跨周的条能停在同一行；同 lane 的按列序兜底
  return segs.sort((a, b) => a.bar.lane - b.bar.lane || a.colStart - b.colStart);
}

function SpanBarView({ seg, onPick }: { seg: WeekSegment; onPick: () => void }) {
  const { bar } = seg;
  const range = bar.startKey === bar.endKey ? bar.startKey : `${bar.startKey} → ${bar.endKey}`;
  return (
    <button
      type="button"
      className="cal-span"
      style={{ gridRow: bar.lane + 2, gridColumn: `${seg.colStart + 1} / ${seg.colEnd + 2}` }}
      onClick={onPick}
      title={`${bar.title}（${range}）`}
    >
      {seg.clippedStart && <span className="cal-span-clip">◀</span>}
      <BarLabel bar={bar} />
      {seg.clippedEnd && <span className="cal-span-clip">▶</span>}
    </button>
  );
}
