import { useMemo, useState } from 'react';
import { listEvents } from '../../core/repo/events';
import { listPersons } from '../../core/repo/persons';
import { EventForm } from '../event';
import { Empty } from '../common';
import { useVersion, bump } from '../../store';
import type { DREvent } from '../../core/types';
import type { TimelineFilter } from './filter';
import { MonthGroup, groupByMonth } from './EventGroup';
import { TrashModal } from './TrashModal';

export function Timeline({ filter, keyword }: { filter: TimelineFilter; keyword: string }) {
  const v = useVersion();
  const persons = useMemo(() => listPersons({ includeArchived: true }), [v]);
  const nameOf = (id: string) => persons.find((p) => p.id === id)?.displayName ?? '?';

  const events = useMemo<DREvent[]>(() => {
    const from = filter.withinDays ? Date.now() - Number(filter.withinDays) * 86400000 : undefined;
    return listEvents({
      keyword: keyword || filter.keyword || undefined,
      personId: filter.personId || undefined,
      kind: filter.kind || undefined,
      tag: filter.tag || undefined,
      minRating: filter.minRating ? Number(filter.minRating) : undefined,
      fromTs: from,
      collectionId: filter.collectionId || undefined,
    });
  }, [v, filter, keyword]);

  const [editing, setEditing] = useState<DREvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const groups = useMemo(() => groupByMonth(events), [events]);

  return (
    <div className="timeline">
      <div className="timeline-head">
        <h3>
          时间线 <span className="muted">{events.length} 条</span>
        </h3>
        <div>
          <button className="btn btn-sm" onClick={() => setTrashOpen(true)}>
            回收站
          </button>
          <button className="btn btn-primary btn-new-inline" onClick={() => setCreating(true)}>
            ＋ 记一件事
          </button>
        </div>
      </div>

      {events.length === 0 && <Empty text="没有符合条件的事件" />}

      {groups.map(([month, list]) => (
        <MonthGroup key={month} month={month} events={list} nameOf={nameOf} onEdit={setEditing} />
      ))}

      {editing && (
        <EventForm
          event={editing}
          onClose={() => {
            setEditing(null);
            bump();
          }}
        />
      )}
      {creating && (
        <EventForm
          onClose={() => {
            setCreating(false);
            bump();
          }}
        />
      )}
      {trashOpen && <TrashModal onClose={() => setTrashOpen(false)} />}
    </div>
  );
}
