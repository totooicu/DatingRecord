// 相关事件列表：点一条直接打开编辑弹窗
//
// 一个人的事件可以攒到几百上千条，这里和人物列表一样分页，
// 共用同一颗分页控件与同一个「每页条数」偏好——详情页不再一次把全部 DOM 铺出来。
import { useState } from 'react';
import { getEvent } from '../../core/repo/events';
import { EventForm } from '../event';
import { bump } from '../../store';
import { formatTime } from '../../core/time';
import { usePaged } from '../common/usePaged';
import { Paginator } from '../common/Paginator';
import { usePageSize } from '../prefs';
import type { DREvent } from '../../core/types';

export function PersonEvents({ events }: { events: DREvent[] }) {
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const paged = usePaged(events, usePageSize());

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h4 className="card-title">相关事件（{events.length}）</h4>
        </div>
        {events.length === 0 && <p className="muted">还没有和 TA 的事件</p>}
        <ul className="event-list">
          {paged.pageItems.map((e) => (
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
        <Paginator paged={paged} />
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
