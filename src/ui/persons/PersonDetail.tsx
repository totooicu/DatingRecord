import { useMemo, useState } from 'react';
import { getPerson, listDefs, statsOf } from '../../core/repo/persons';
import { listEvents } from '../../core/repo/events';
import { EventForm } from '../event';
import { Empty } from '../common';
import { useVersion, bump } from '../../store';
import { hides } from '../../privacy';
import { PersonHead } from './PersonHead';
import { PersonStats } from './PersonStats';
import { PersonAttrs } from './PersonAttrs';
import { AttrHistory } from './AttrHistory';
import { PersonEvents } from './PersonEvents';

export function PersonDetail({ id, onArchived }: { id: string; onArchived?: (nextId: string | null) => void }) {
  const v = useVersion();
  const person = useMemo(() => getPerson(id), [id, v]);
  const defs = useMemo(() => listDefs(), [v]);
  const stats = useMemo(() => statsOf(id), [id, v]);
  const events = useMemo(() => listEvents({ personId: id }), [id, v]);
  const [newEvent, setNewEvent] = useState(false);

  if (!person) return <Empty text="人物不存在或已删除" />;
  // 隐私模式 + 标了隐私：详情也藏起来，不能从详情页漏出
  if (hides(person)) return <Empty text="该人物已设为隐私，隐私模式下不显示" />;

  return (
    <div className="detail">
      <PersonHead person={person} onNewEvent={() => setNewEvent(true)} onArchived={onArchived} />
      <PersonStats stats={stats} />
      <PersonAttrs person={person} defs={defs} />
      {/* key：换人物时重置展开态与选中项，否则会继承上一个人的状态 */}
      <AttrHistory key={id} personId={id} defs={defs} />
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
