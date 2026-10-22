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
        上下滚动日历可连续翻看各个月份，当前月默认居中；点标题里的年 / 月可直接跳到任意月份。
        每月 1 号会在日期前标出月份（如 7.1、12.1），连续滚动时当作月份标尺。
        用上方「最早 / 上一日 / 下一日 / 最晚」可直接在有事件的日子之间跳，不用翻空日期。
        事件都画成横条：跨天事件跨几格占几格，单日事件占一格（与日期框同宽）。
        点任意一格或任意一条横条，回时间线看那一天的事。灰底是过去、黄底是今天、白底是将来；
        筛选只影响日历上的标记，不会改动任何数据。
      </p>
    </div>
  );
}
