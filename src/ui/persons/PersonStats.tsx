// 四格概览：事件数 / 最近见面 / 总花费 / 平均评分
import { relativeDays } from '../../core/time';
import type { PersonStats } from '../../core/repo/persons';

export function PersonStats({ stats }: { stats: PersonStats }) {
  return (
    <div className="stat-row">
      <div className="stat-card">
        <span className="stat-num">{stats.eventCount}</span>
        <span className="stat-label">事件</span>
      </div>
      <div className="stat-card">
        <span className="stat-num">
          {stats.lastMeetTs ? relativeDays(new Date(stats.lastMeetTs).toISOString()) : '—'}
        </span>
        <span className="stat-label">最近见面</span>
      </div>
      <div className="stat-card">
        <span className="stat-num">¥{stats.totalCost.toFixed(0)}</span>
        <span className="stat-label">总花费</span>
      </div>
      <div className="stat-card">
        <span className="stat-num">{stats.avgRating ? stats.avgRating.toFixed(1) : '—'}</span>
        <span className="stat-label">平均评分</span>
      </div>
    </div>
  );
}
