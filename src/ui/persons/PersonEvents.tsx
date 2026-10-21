// 相关事件列表：点一条直接打开编辑弹窗
import { useState } from 'react';
import { getEvent } from '../../core/repo/events';
import { EventForm } from '../event';
import { bump } from '../../store';
import { formatTime } from '../../core/time';
import type { DREvent } from '../../core/types';

export function PersonEvents({ events }: { events: DREvent[] }) {
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
            <li key={e.id}>
              <button className="event-item" onClick={() => setEditingEventId(e.id)}>
                <span className="event-time">{formatTime(e.time)}</span>
                <span className="event-title">{e.title}</span>
                <span className="event-meta">
                  {e.metrics.rating ? '★'.repeat(e.metrics.rating) : ''}
                  {e.metrics.cost ? ` ¥${e.metrics.cost}` : ''}
                </span>
              </button>
            </li>
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
