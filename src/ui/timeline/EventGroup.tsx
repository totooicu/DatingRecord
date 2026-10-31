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
      <div className="month-label">
        <span>{month === '时间未知' ? '时间未知' : month.replace('-', ' 年 ') + ' 月'}</span>
        <i className="month-rule" />
        <span className="month-count">{events.length} 条</span>
      </div>
      <ul className="event-list">
        {events.map((e) => (
          <EventRow key={e.id} event={e} nameOf={nameOf} onEdit={onEdit} />
        ))}
      </ul>
    </section>
  );
}

/** 单行事件：左边一栏时间（日期 / 时刻），右边标题 - 人物 - 事实 - 摘要 */
export function EventRow({
  event: e,
  nameOf,
  onEdit,
  omitPersonId,
}: {
  event: DREvent;
  nameOf: (id: string) => string;
  onEdit: (e: DREvent) => void;
  /** 人物详情页：TA 自己那行名字是重复信息，从参与者里去掉 */
  omitPersonId?: string;
}) {
  // 全天/只到日的事件没有时刻，formatCompact 只给日期，正好拆成两行
  const compact = formatCompact(e.startTs, e.time.allDay === true || e.time.precision === 'day');
  const [day, clock] = compact === '时间未知' ? ['未知', undefined] : compact.split(' ');
  const people = e.participants
    .filter((p) => p.personId !== omitPersonId)
    .map((p) => nameOf(p.personId))
    .join('、');
  const excerpt = e.content.trim() ? markdownExcerpt(e.content, 80) : '';
  const rating = e.metrics.rating ?? 0;
  const hasFacts = rating > 0 || !!e.metrics.cost || e.tags.length > 0 || e.relatedEvents.length > 0;

  return (
    <li>
      <button className="event-item" onClick={() => onEdit(e)} title={formatTime(e.time)}>
        <span className="event-when">
          <span className="event-day">{day}</span>
          {(clock || e.time.kind === 'fuzzy') && (
            <span className="event-clock">
              {clock}
              {e.time.kind === 'fuzzy' && ' ~'}
            </span>
          )}
        </span>
        <span className="event-main">
          <span className="event-title">
            <span className="event-title-text">{e.title}</span>
            {e.isPrivate && <span className="privacy-badge">隐私</span>}
            {people && <span className="event-people">{people}</span>}
          </span>
          {hasFacts && (
            <span className="event-facts">
              {rating > 0 && (
                <span className="ev-chip ev-chip-star" title={`评分 ${rating} 星`}>
                  {'★'.repeat(rating)}
                </span>
              )}
              {!!e.metrics.cost && <span className="ev-chip">{`¥${e.metrics.cost}`}</span>}
              {e.tags.map((t) => (
                <span key={t} className="ev-chip ev-chip-tag">
                  {t}
                </span>
              ))}
              {e.relatedEvents.length > 0 && (
                <span className="ev-chip event-rel" title={`关联了 ${e.relatedEvents.length} 个事件`}>
                  {`关联 ${e.relatedEvents.length}`}
                </span>
              )}
            </span>
          )}
          {/* 正文此前没有任何展示点，写完了只能在编辑框里看到 */}
          {excerpt && <span className="event-excerpt">{excerpt}</span>}
        </span>
      </button>
    </li>
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
