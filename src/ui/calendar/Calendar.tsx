// 日历视图（入口页）。
//
// 点某一天 → 把时间线的筛选切到「那一天」并跳过去，
// 这样日历只负责「找到哪天有事」，具体内容仍然由时间线呈现，
// 不另起一套事件列表。
import { useState } from 'react';
import { MonthView } from './MonthView';
import { CalendarFilters } from './Filters';
import { EMPTY_CALENDAR_FILTER, type CalendarFilter } from '../../core/calendar';

export function Calendar({ onPickDay }: { onPickDay: (key: string) => void }) {
  // 筛选状态放在「页」这一层：切月份不丢，离开日历页再回来重置（和别的页一致）
  const [filter, setFilter] = useState<CalendarFilter>(EMPTY_CALENDAR_FILTER);

  return (
    <div className="calendar">
      <CalendarFilters filter={filter} onChange={setFilter} />
      <MonthView filter={filter} onPickDay={onPickDay} />
      <p className="muted small cal-tip">
        点任意一格，回时间线看那一天的事。灰底是过去、黄底是今天、白底是将来。
        筛选只影响日历上的标记，不会改动任何数据。
      </p>
    </div>
  );
}
