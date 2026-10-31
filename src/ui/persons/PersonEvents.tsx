// 人物详情 → 相关事件：直接复用时间线的事件行（EventRow），
// 别再手写一套 .event-time / .event-meta —— 那两个类名早就没了，
// 结果就是时间被塞进 44px 的网格列里换三行、评分和花费掉到时间下面。
import { useState } from 'react';
import { getEvent } from '../../core/repo/events';
import { EventForm } from '../event';
import { bump } from '../../store';
import { EventRow } from '../timeline/EventGroup';
import { personNameOf } from './personName';
import type { DREvent } from '../../core/types';

export function PersonEvents({ personId, events }: { personId: string; events: DREvent[] }) {
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h4 className="card-title">相关事件（{events.length}）</h4>
        </div>
        {events.length === 0 && <p className="muted">还没有和 TA 的事件</p>}
        <ul className="event-list">
          {events.map((e) => (
            <EventRow
              key={e.id}
              event={e}
              nameOf={personNameOf}
              omitPersonId={personId}
              onEdit={(ev) => setEditingEventId(ev.id)}
            />
          ))}
        </ul>
      </section>

      {editingEventId && (
        <EventForm
          event={getEvent(editingEventId) ?? undefined}
          onClose={() => {
            setEditingEventId(null);
            bump();
          }}
        />
      )}
    </>
  );
}
