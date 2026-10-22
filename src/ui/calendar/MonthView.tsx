// 月视图日历：一格一天，上方日期、下方当天涉及的事件集图标。
//
// 配色只有三种状态，用户不用记任何图例：
//   过去 —— 灰底，读作「已经发生」
//   今天 —— 黄底，一眼定位
//   将来 —— 白底
//
// 点某一天 → 回时间线并按那天过滤（见 MonthView 的 onPickDay 回调）。
import { useMemo, useState } from 'react';
import { buildMonthGrid, collectDaySummaries, monthOf, monthLabel, shiftMonth, todayKey, WEEKDAY_LABELS, type DayCell, type MonthRef } from '../../core/calendar';
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
        {grid.map((cell) => (
          <DayCellView
            key={cell.key}
            cell={cell}
            summary={summaries.get(cell.key)}
            onPick={() => onPickDay(cell.key)}
          />
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
  summary?: { count: number; collections: { id: string; name: string; icon: import('../../core/types').CollectionIcon | null }[] };
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
