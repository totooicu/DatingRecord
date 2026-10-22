// 月视图日历：一格一天，日期下面滚动展示当天的事件（事件集图标 + 事件名）。
//
// 配色只有三种状态，用户不用记任何图例：
//   过去 —— 灰底，读作「已经发生」
//   今天 —— 黄底，一眼定位
//   将来 —— 白底
//
// 跨天事件（区间 1→3 号）额外画一条横跨多格的色条，落在所在周的日期格子下方；
// 单日事件不画条，在格子里用「图标 + 标题」滚动展示。
//
// 切换月份：在日历上上下滑动，或点标题里的年 / 月打开选择器直接跳转。
// 点某一天 → 回时间线并按那天过滤（见 MonthView 的 onPickDay 回调）。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  type DayEvent,
  type DaySummary,
  type MonthRef,
  type SpanBar,
} from '../../core/calendar';
import { useVersion } from '../../store';
import { Modal } from '../common';
import { CollectionIconView } from '../collections/CollectionIcon';

/** 竖向滑动多少像素算一次翻月 */
const SWIPE_THRESHOLD = 56;

export function MonthView({
  onPickDay,
  filter = EMPTY_CALENDAR_FILTER,
}: {
  onPickDay: (key: string) => void;
  filter?: CalendarFilter;
}) {
  const v = useVersion();
  const today = todayKey();
  const [month, setMonth] = useState<MonthRef>(() => monthOf(new Date()));
  const [picker, setPicker] = useState<'month' | 'year' | null>(null);
  const calRef = useRef<HTMLDivElement>(null);

  const grid = useMemo(() => buildMonthGrid(month, today), [month, today]);
  // v 触发重算：刚记完一件事，日历要立刻反应过来
  const summaries = useMemo(() => collectDaySummaries(filter), [v, filter]);
  const monthCounts = useMemo(() => collectMonthCounts(filter), [v, filter]);
  const spanBars = useMemo(() => collectSpanBars(month, filter), [month, v, filter]);

  const weeks = useMemo(() => {
    const out: DayCell[][] = [];
    for (let i = 0; i < grid.length; i += 7) out.push(grid.slice(i, i + 7));
    return out;
  }, [grid]);

  const monthCellCount = grid.filter((c) => c.inMonth && summaries.has(c.key)).length;
  const monthCount = monthCounts.get(monthKey(month)) ?? 0;
  const isThisMonth = month.year === Number(today.slice(0, 4)) && month.month === Number(today.slice(5, 7)) - 1;

  // 上下滑动翻月：手势里一旦确认是纵向，就把页面滚动让给日历，
  // 否则手机上一滑先滚页面，月份根本切不动。
  useEffect(() => {
    const el = calRef.current;
    if (!el) return;
    let y0: number | null = null;
    let x0 = 0;

    const onStart = (e: TouchEvent) => {
      // 选择月份的弹层里有自己的滚动/点击，别把它当成翻月手势
      if ((e.target as Element | null)?.closest?.('.modal')) {
        y0 = null;
        return;
      }
      if (e.touches.length !== 1) {
        y0 = null;
        return;
      }
      y0 = e.touches[0].clientY;
      x0 = e.touches[0].clientX;
    };
    const onMove = (e: TouchEvent) => {
      if (y0 === null) return;
      const dy = e.touches[0].clientY - y0;
      const dx = e.touches[0].clientX - x0;
      if (Math.abs(dy) <= 10 || Math.abs(dy) <= Math.abs(dx) * 1.2) return;
      e.preventDefault();
      if (Math.abs(dy) >= SWIPE_THRESHOLD) {
        y0 = null;
        // 手指往上推 = 看下个月，和刷列表的方向一致
        setMonth((m) => shiftMonth(m, dy < 0 ? 1 : -1));
      }
    };
    const onEnd = () => {
      y0 = null;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  // 年份列表覆盖「有记录的年份」，并在当前年 / 正在看的年两边各留 5 年，
  // 让人能翻到没有记录的年份（计划将来、回看旧年份都用得上）
  const years = useMemo(() => {
    let min = Math.min(month.year, Number(today.slice(0, 4))) - 5;
    let max = Math.max(month.year, Number(today.slice(0, 4))) + 5;
    for (const key of monthCounts.keys()) {
      const y = Number(key.slice(0, 4));
      if (y < min) min = y;
      if (y > max) max = y;
    }
    const out: number[] = [];
    for (let y = min; y <= max; y += 1) out.push(y);
    return out;
  }, [monthCounts, month.year, today]);

  const countOfYear = (year: number) => {
    let n = 0;
    for (let m = 0; m < 12; m += 1) n += monthCounts.get(monthKey({ year, month: m })) ?? 0;
    return n;
  };

  return (
    <div className="cal" ref={calRef}>
      <div className="cal-head">
        <div className="cal-title">
          <div className="cal-title-row">
            <button className="cal-title-btn" onClick={() => setPicker('year')} title="选择年份">
              {month.year} 年
            </button>
            <button className="cal-title-btn" onClick={() => setPicker('month')} title="选择月份">
              {month.month + 1} 月
            </button>
          </div>
          <span className="muted small">
            {monthCount} 件事 · {monthCellCount} 天有记录
          </span>
        </div>
        {!isThisMonth && (
          <button className="btn btn-sm" onClick={() => setMonth(monthOf(new Date()))}>
            回今天
          </button>
        )}
      </div>

      <div className="cal-weekdays" aria-hidden>
        {WEEKDAY_LABELS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="cal-grid" role="grid">
        {weeks.map((week) => (
          <div className="cal-week" key={week[0].key}>
            {week.map((cell) => (
              <DayCellView
                key={cell.key}
                cell={cell}
                summary={summaries.get(cell.key)}
                onPick={() => onPickDay(cell.key)}
              />
            ))}
            {weekSegments(week, spanBars).map((seg, idx) => (
              <SpanBarView
                key={`${seg.bar.eventId}-${week[0].key}`}
                seg={seg}
                row={idx + 2}
                onPick={() => onPickDay(seg.key)}
              />
            ))}
          </div>
        ))}
      </div>

      {picker === 'month' && (
        <Modal title={`${month.year} 年，选择月份`} onClose={() => setPicker(null)}>
          <div className="cal-pick-grid">
            {Array.from({ length: 12 }, (_, m) => {
              const key = monthKey({ year: month.year, month: m });
              const count = monthCounts.get(key) ?? 0;
              const on = m === month.month;
              return (
                <button
                  key={key}
                  className={on ? 'cal-pick cal-pick-on' : 'cal-pick'}
                  onClick={() => {
                    setMonth({ year: month.year, month: m });
                    setPicker(null);
                  }}
                >
                  <strong>{m + 1} 月</strong>
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
                  className={y === month.year ? 'cal-year-row cal-year-row-on' : 'cal-year-row'}
                  onClick={() => {
                    setMonth({ year: y, month: month.month });
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
  summary,
  onPick,
}: {
  cell: DayCell;
  summary?: DaySummary;
  onPick: () => void;
}) {
  const count = summary?.count ?? 0;
  const title = summary ? `${cell.key}　${count} 件事` : cell.key;

  return (
    <button
      type="button"
      className={`cal-cell cal-${cell.phase}${cell.inMonth ? '' : ' cal-out'}`}
      onClick={onPick}
      title={title}
      data-day={cell.key}
    >
      <span className="cal-date">{cell.day}</span>
      {summary && summary.events.length > 0 && <DayTicker events={summary.events} />}
    </button>
  );
}

/**
 * 格子里的「图标 + 事件名」：
 * 放得下就静止，放不下就复制一份、向左匀速滚动，鼠标/手指不用悬停也能读完。
 */
function DayTicker({ events }: { events: DayEvent[] }) {
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
      if (over) setDuration(Math.max(5, Math.round(content / 12)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    ro.observe(track);
    return () => ro.disconnect();
  }, [events, running]);

  const copy = (n: number) => (
    <span className="cal-ticker-copy" key={n}>
      {events.map((ev) => (
        <span className="cal-ev" key={ev.id}>
          <CollectionIconView icon={ev.icon} size="sm" fallback={ev.title} />
          <span className="cal-ev-title">{ev.title}</span>
        </span>
      ))}
    </span>
  );

  return (
    <span className={running ? 'cal-events cal-events-run' : 'cal-events'} ref={boxRef}>
      <span
        className="cal-ticker"
        ref={trackRef}
        style={running ? { animationDuration: `${duration}s` } : undefined}
      >
        {copy(0)}
        {running && copy(1)}
      </span>
    </span>
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
  // 行号是全局分配的，周内按行号排；同一行的按列序兜底
  return segs.sort((a, b) => a.bar.lane - b.bar.lane || a.colStart - b.colStart);
}

function SpanBarView({ seg, row, onPick }: { seg: WeekSegment; row: number; onPick: () => void }) {
  const { bar } = seg;
  return (
    <button
      type="button"
      className="cal-span"
      style={{ gridRow: row, gridColumn: `${seg.colStart + 1} / ${seg.colEnd + 2}` }}
      onClick={onPick}
      title={`${bar.title}（${bar.startKey} → ${bar.endKey}）`}
    >
      {seg.clippedStart && <span className="cal-span-clip">◀</span>}
      {bar.icon && <CollectionIconView icon={bar.icon} size="sm" fallback={bar.title} />}
      <span className="cal-span-title">{bar.title}</span>
      {seg.clippedEnd && <span className="cal-span-clip">▶</span>}
    </button>
  );
}
