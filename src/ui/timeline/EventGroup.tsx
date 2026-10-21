// 一个月的事件分组 + 单条事件行
import { markdownExcerpt } from '../../core/markdown';
import { formatCompact, formatTime } from '../../core/time';
import type { DREvent } from '../../core/types';

export function MonthGroup({
  month,
  events,
  nameOf,
  onEdit,
}: {
  month: string;
  events: DREvent[];
  nameOf: (id: string) => string;
  onEdit: (e: DREvent) => void;
}) {
  return (
    <section className="month-group">
      <div className="month-label">{month === '时间未知' ? '时间未知' : month.replace('-', ' 年 ') + ' 月'}</div>
      <ul className="event-list">
        {events.map((e) => (
          <li key={e.id}>
            <button className="event-item" onClick={() => onEdit(e)}>
              <span className="event-time" title={formatTime(e.time)}>
                {formatCompact(e.startTs, e.time.allDay === true || e.time.precision === 'day')}
                {e.time.kind === 'fuzzy' && ' ~'}
              </span>
              <span className="event-title">{e.title}</span>
              <span className="event-people">{e.participants.map((p) => nameOf(p.personId)).join('、')}</span>
              <span className="event-meta">
                {e.metrics.rating ? '★'.repeat(e.metrics.rating) : ''}
                {e.metrics.cost ? ` ¥${e.metrics.cost}` : ''}
                {e.tags.length ? ` #${e.tags.join(' #')}` : ''}
              </span>
              {/* 正文此前没有任何展示点，写完了只能在编辑框里看到 */}
              {e.content.trim() && <span className="event-excerpt">{markdownExcerpt(e.content, 60)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 按「年-月」分组；没有开始时间的事件归到「时间未知」 */
export function groupByMonth(events: DREvent[]): [string, DREvent[]][] {
  const map = new Map<string, DREvent[]>();
  for (const e of events) {
    const key = e.startTs ? new Date(e.startTs).toISOString().slice(0, 7) : '时间未知';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.entries());
}
