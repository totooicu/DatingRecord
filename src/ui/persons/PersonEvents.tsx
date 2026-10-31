// 人物详情 → 相关事件：行样式复用时间线的 EventRow，列表和人物列表一样分页。
//
// 一个人的事件可以攒到几百上千条，这里和人物列表共用同一颗分页控件与同一个
// 「每页条数」偏好——详情页不再一次把全部 DOM 铺出来。
// 行本身别再手写 .event-time / .event-meta：那两个类名早已随时间线改版删掉，
// 结果就是完整时间被塞进 44px 的窄列换三行、评分和花费掉到时间下面。
import { useState } from 'react';
import { getEvent } from '../../core/repo/events';
import { EventForm } from '../event';
import { bump } from '../../store';
import { EventRow } from '../timeline/EventGroup';
import { personNameOf } from './personName';
import { usePaged } from '../common/usePaged';
import { Paginator } from '../common/Paginator';
import { usePageSize } from '../prefs';
import type { DREvent } from '../../core/types';
import { Empty } from '../common';

export function PersonEvents({ personId, events }: { personId: string; events: DREvent[] }) {
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const paged = usePaged(events, usePageSize());

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h4 className="card-title">相关事件（{events.length}）</h4>
        </div>
        {events.length === 0 && <Empty compact text="还没有和 TA 的事件" />}
        <ul className="event-list">
          {paged.pageItems.map((e) => (
            <EventRow
              key={e.id}
              event={e}
              nameOf={personNameOf}
              omitPersonId={personId}
              onEdit={(ev) => setEditingEventId(ev.id)}
            />
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
