// 「添加事件到集合」弹窗：关键词过滤，最多列 50 条候选
import { useMemo, useState } from 'react';
import { addMember, listMembers } from '../../core/repo/collections';
import { listEvents } from '../../core/repo/events';
import { Field, Modal } from '../common';
import { useVersion, bump } from '../../store';
import { formatTime } from '../../core/time';

export function AddEventModal({ collectionId, onClose }: { collectionId: string; onClose: () => void }) {
  const v = useVersion();
  const [kw, setKw] = useState('');
  const allEvents = useMemo(() => listEvents(), [v]);
  const memberIds = useMemo(
    () => new Set(listMembers(collectionId).map((m) => m.memberId)),
    [v, collectionId],
  );
  const candidates = allEvents
    .filter((e) => !memberIds.has(e.id) && (kw ? e.title.includes(kw) : true))
    .slice(0, 50);

  return (
    <Modal title="添加事件到集合" onClose={onClose}>
      <Field label="搜索事件">
        <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="输入标题关键词" />
      </Field>
      <ul className="pick-list">
        {candidates.map((e) => (
          <li key={e.id}>
            <button
              onClick={() => {
                addMember(collectionId, 'event', e.id);
                bump();
                onClose();
              }}
            >
              <span>{e.title}</span>
              <span className="muted">{formatTime(e.time)}</span>
            </button>
          </li>
        ))}
        {candidates.length === 0 && <li className="muted">没有可添加的事件</li>}
      </ul>
    </Modal>
  );
}
