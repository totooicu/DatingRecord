import { useEffect, useMemo, useState } from 'react';
import {
  getBreadcrumb,
  getCollection,
  listChildren,
  listMembers,
} from '../../core/repo/collections';
import { getEvent } from '../../core/repo/events';
import { EventForm } from '../event';
import { Empty } from '../common';
import { useVersion, bump } from '../../store';
import { CollectionHead } from './CollectionHead';
import { CollectionStats } from './CollectionStats';
import { MemberList, ChildList } from './MemberList';
import { AddEventModal } from './AddEventModal';
import { MoveModal } from './MoveModal';

export function CollectionDetail({ id }: { id: string }) {
  const v = useVersion();
  const collection = useMemo(() => getCollection(id), [id, v]);
  const members = useMemo(() => listMembers(id), [id, v]);
  const children = useMemo(() => listChildren(id), [id, v]);
  const breadcrumb = useMemo(() => getBreadcrumb(id), [id, v]);

  const [addOpen, setAddOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (msg) {
      const t = setTimeout(() => setMsg(null), 2500);
      return () => clearTimeout(t);
    }
  }, [msg]);

  if (!collection) return <Empty text="事件集不存在或已删除" />;

  return (
    <div className="detail">
      <CollectionHead
        collection={collection}
        breadcrumb={breadcrumb}
        onMove={() => setMoveOpen(true)}
        onError={setMsg}
      />

      {msg && <div className="alert">{msg}</div>}

      <CollectionStats collectionId={id} members={members} children={children} />
      <ChildList children={children} />
      <MemberList
        collectionId={id}
        members={members}
        onEditEvent={setEditingEventId}
        onAdd={() => setAddOpen(true)}
      />

      {addOpen && <AddEventModal collectionId={id} onClose={() => setAddOpen(false)} />}
      {moveOpen && (
        <MoveModal collectionId={id} onClose={() => setMoveOpen(false)} onError={setMsg} />
      )}
      {editingEventId && (
        <EventForm
          event={getEvent(editingEventId) ?? undefined}
          onClose={() => {
            setEditingEventId(null);
            bump();
          }}
        />
      )}
    </div>
  );
}
