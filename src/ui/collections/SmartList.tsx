// 智能集合的成员列表（F-C04）：动态求值结果，只读展示，不能手动增删改序
import { EVENT_KINDS } from '../../core/repo/events';
import { getPerson } from '../../core/repo/persons';
import { describeRule } from '../../core/repo/collections';
import { formatTime } from '../../core/time';
import type { DREvent, SmartRule } from '../../core/types';
import type { CollectionView } from '../prefs';
import { EventViewToggle } from './EventViewToggle';

export function SmartList({
  events,
  rule,
  view,
  onView,
  onEditEvent,
  onEditRule,
}: {
  events: DREvent[];
  rule: SmartRule | null;
  view: CollectionView;
  onView: (v: CollectionView) => void;
  onEditEvent: (id: string) => void;
  onEditRule: () => void;
}) {
  const kindLabel = (k: string) => EVENT_KINDS.find((x) => x.value === k)?.label ?? k;

  return (
    <section className="card">
      <div className="card-head">
        <h4 className="card-title">命中事件（{events.length}）</h4>
        <div className="card-head-actions">
          <EventViewToggle view={view} onChange={onView} />
          <button className="btn btn-sm" onClick={onEditRule}>
            编辑规则
          </button>
        </div>
      </div>
      <p className="muted small rule-summary">{describeRule(rule)}</p>
      {events.length === 0 ? (
        <p className="muted">还没有事件满足当前规则。</p>
      ) : (
        <ul className="member-list">
          {events.map((ev) => (
            <li key={ev.id}>
              <span className="member-type">{kindLabel(ev.kind)}</span>
              <div className="member-main">
                <button className="member-title" onClick={() => onEditEvent(ev.id)}>
                  {ev.title}
                </button>
                <div className="member-meta muted small">
                  <span>{formatTime(ev.time)}</span>
                  {ev.participants[0] && (
                    <>
                      <span>·</span>
                      <span>{getPerson(ev.participants[0].personId)?.displayName ?? ''}</span>
                    </>
                  )}
                  {!!ev.metrics.rating && (
                    <>
                      <span>·</span>
                      <span>★ {ev.metrics.rating}</span>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">成员由规则实时算出：新建事件满足条件会自动进来，删除后自动消失。</p>
    </section>
  );
}
