// 日历视图（入口页）。
//
// 点某一天 → 把时间线的筛选切到「那一天」并跳过去，
// 这样日历只负责「找到哪天有事」，具体内容仍然由时间线呈现，
// 不另起一套事件列表。
import { MonthView } from './MonthView';

export function Calendar({ onPickDay }: { onPickDay: (key: string) => void }) {
  return (
    <div className="calendar">
      <MonthView onPickDay={onPickDay} />
      <p className="muted small cal-tip">
        点任意一格，回时间线看那一天的事。灰底是过去、黄底是今天、白底是将来。
      </p>
    </div>
  );
}
