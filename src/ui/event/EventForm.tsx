import { useMemo, useState } from 'react';
import { createEvent, deleteEvent, updateEvent } from '../../core/repo/events';
import { listPersons } from '../../core/repo/persons';
import {
  addMember,
  collectionsOfEvent,
  getTree,
  removeMember,
  type TreeNode,
} from '../../core/repo/collections';
import type { Collection, DREvent } from '../../core/types';
import { ConfirmButton, Modal } from '../common';
import { bump } from '../../store';
import { EventFields } from './EventFields';
import { draftToPayload, initialDraft, type EventDraft } from './draft';

export function EventForm({
  event,
  defaultPersonId,
  defaultCollectionId,
  onClose,
}: {
  event?: DREvent;
  defaultPersonId?: string;
  defaultCollectionId?: string;
  onClose: () => void;
}) {
  const persons = useMemo(() => listPersons({ includeArchived: true }), []);
  const flat = useMemo(() => flatten(getTree()), []);
  const existingCols = useMemo(
    () => (event ? collectionsOfEvent(event.id).map((c) => c.id) : []),
    [event?.id],
  );

  const [d, setD] = useState<EventDraft>(() =>
    initialDraft(event, defaultPersonId, defaultCollectionId, existingCols),
  );
  const patch = (p: Partial<EventDraft>) => setD((s) => ({ ...s, ...p }));

  const save = () => {
    const payload = draftToPayload(d);
    if (event) {
      updateEvent(event.id, payload);
      const before = new Set(existingCols);
      const after = new Set(d.cols);
      for (const id of after) if (!before.has(id)) addMember(id, 'event', event.id);
      for (const id of before) if (!after.has(id)) removeMember(id, 'event', event.id);
    } else {
      const created = createEvent(payload);
      for (const id of d.cols) addMember(id, 'event', created.id);
    }
    bump();
    onClose();
  };

  return (
    <Modal
      wide
      title={event ? '编辑事件' : '新建事件'}
      onClose={onClose}
      footer={
        <>
          {event && (
            <ConfirmButton
              text="删除"
              danger
              confirmText="删除这个事件？它会先进「设置 → 归档与回收」，之后可以恢复或彻底删除。"
              onConfirm={() => {
                deleteEvent(event.id);
                bump();
                onClose();
              }}
            />
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <EventFields d={d} patch={patch} persons={persons} flat={flat} />
    </Modal>
  );
}

function flatten(node: TreeNode | null): { c: Collection; depth: number }[] {
  const out: { c: Collection; depth: number }[] = [];
  const walk = (n: TreeNode, d: number) => {
    out.push({ c: n, depth: d });
    for (const k of n.children) walk(k, d + 1);
  };
  if (node) walk(node, 0);
  return out;
}
