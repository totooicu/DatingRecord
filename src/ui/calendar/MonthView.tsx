// 月视图日历：一格一天，上方日期、下方当天涉及的事件集图标。
//
// 配色只有三种状态，用户不用记任何图例：
//   过去 —— 灰底，读作「已经发生」
//   今天 —— 黄底，一眼定位
//   将来 —— 白底
//
// 跨天事件（区间 1→3 号）额外画一条横跨多格的色条，落在所在周的日期格子下方；
// 单日事件不画条，仍用格子里的图标表达，避免小屏上条和图标互相挤。
//
// 点某一天 → 回时间线并按那天过滤（见 MonthView 的 onPickDay 回调）。
import { useMemo, useState } from 'react';
import {
  buildMonthGrid,
  collectDaySummaries,
  collectSpanBars,
  monthOf,
  monthLabel,
  shiftMonth,
  todayKey,
  WEEKDAY_LABELS,
  type DayCell,
  type DaySummary,
  type MonthRef,
  type SpanBar,
} from '../../core/calendar';
import { useVersion } from '../../store';
import { CollectionIconView } from '../collections/CollectionIcon';

/** 一格最多摆几个图标；再多的用 +N 收口，免得格子被撑爆 */
const MAX_ICONS = 3;

export function MonthView({ onPickDay }: { onPickDay: (key: string) => void }) {
  const v = useVersion();
  const today = todayKey();
  const [month, setMonth] = useState<MonthRef>(() => monthOf(new Date()));

  const grid = useMemo(() => buildMonthGrid(month, today), [month, today]);
  // v 触发重算：刚记完一件事，日历要立刻反应过来
  const summaries = useMemo(() => collectDaySummaries(), [v]);
  const spanBars = useMemo(() => collectSpanBars(month), [month, v]);

  const weeks = useMemo(() => {
    const out: DayCell[][] = [];
    for (let i = 0; i < grid.length; i += 7) out.push(grid.slice(i, i + 7));
    return out;
  }, [grid]);

  const monthCellCount = grid.filter((c) => c.inMonth && summaries.has(c.key)).length;
  const isThisMonth = month.year === Number(today.slice(0, 4)) && month.month === Number(today.slice(5, 7)) - 1;

  return (
    <div className="cal">
      <div className="cal-head">
        <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上个月">
          ‹
        </button>
        <div className="cal-title">
          <strong>{monthLabel(month)}</strong>
          <span className="muted small">{monthCellCount} 天有记录</span>
        </div>
        <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="下个月">
          ›
        </button>
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
  const icons = summary?.collections.slice(0, MAX_ICONS) ?? [];
  const more = (summary?.collections.length ?? 0) - icons.length;
  const title = summary ? `${cell.key}　${summary.count} 件事` : cell.key;

  return (
    <button
      type="button"
      className={`cal-cell cal-${cell.phase}${cell.inMonth ? '' : ' cal-out'}`}
      onClick={onPick}
      title={title}
      data-day={cell.key}
    >
      <span className="cal-date">{cell.day}</span>
      <span className="cal-icons">
        {icons.map((c) => (
          <CollectionIconView key={c.id} icon={c.icon} size="sm" fallback={c.name} title={c.name} />
        ))}
        {more > 0 && <span className="cal-more">+{more}</span>}
      </span>
    </button>
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
