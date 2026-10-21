import { useMemo, useState } from 'react';
import { getPerson, listDefs, statsOf } from '../../core/repo/persons';
import { listEvents } from '../../core/repo/events';
import { EventForm } from '../event';
import { Empty } from '../common';
import { useVersion, bump } from '../../store';
import { PersonHead } from './PersonHead';
import { PersonStats } from './PersonStats';
import { PersonAttrs } from './PersonAttrs';
import { PersonEvents } from './PersonEvents';

export function PersonDetail({ id, onArchived }: { id: string; onArchived?: (nextId: string | null) => void }) {
  const v = useVersion();
  const person = useMemo(() => getPerson(id), [id, v]);
  const defs = useMemo(() => listDefs(), [v]);
  const stats = useMemo(() => statsOf(id), [id, v]);
  const events = useMemo(() => listEvents({ personId: id }), [id, v]);
  const [newEvent, setNewEvent] = useState(false);

  if (!person) return <Empty text="人物不存在或已删除" />;

  return (
    <div className="detail">
      <PersonHead person={person} onNewEvent={() => setNewEvent(true)} onArchived={onArchived} />
      <PersonStats stats={stats} />
      <PersonAttrs person={person} defs={defs} />
      <PersonEvents events={events} />

      {newEvent && (
        <EventForm
          defaultPersonId={id}
          onClose={() => {
            setNewEvent(false);
            bump();
          }}
        />
      )}
    </div>
  );
}
