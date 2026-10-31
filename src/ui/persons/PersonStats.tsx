// 四格概览：事件数 / 最近见面 / 总花费 / 平均评分
import { relativeDays } from '../../core/time';
import type { PersonStats } from '../../core/repo/persons';
import { Card } from '../common/Card';

export function PersonStats({ stats }: { stats: PersonStats }) {
  return (
    <div className="stat-row">
      <Card variant="stat" num={stats.eventCount} label="事件" />
      <Card
        variant="stat"
        num={stats.lastMeetTs ? relativeDays(new Date(stats.lastMeetTs).toISOString()) : '—'}
        label="最近见面"
      />
      <Card variant="stat" num={`¥${stats.totalCost.toFixed(0)}`} label="总花费" />
      <Card
        variant="stat"
        num={stats.avgRating ? stats.avgRating.toFixed(1) : '—'}
        label="平均评分"
      />
    </div>
  );
}
