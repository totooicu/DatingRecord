// 「添加事件到集合」弹窗：关键词过滤 + 分页。
// 以前是「最多列 50 条」硬截断——第 51 条既看不见也搜不到（除非关键词刚好命中它）；
// 改成和别处同一颗分页控件，每页条数也跟着设备偏好走。
import { useEffect, useMemo, useState } from 'react';
import { addMember, listMembers } from '../../core/repo/collections';
import { listEvents } from '../../core/repo/events';
import { Field, Modal, Empty } from '../common';
import { usePaged } from '../common/usePaged';
import { Paginator } from '../common/Paginator';
import { usePageSize } from '../prefs';
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
  const candidates = useMemo(
    () => allEvents.filter((e) => !memberIds.has(e.id) && (kw ? e.title.includes(kw) : true)),
    [allEvents, memberIds, kw],
  );
  const paged = usePaged(candidates, usePageSize());
  // 换了关键词就是换了一批结果，留在深页没意义
  useEffect(() => {
    paged.setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kw]);

  return (
    <Modal title="添加事件到集合" onClose={onClose}>
      <Field label="搜索事件">
        <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="输入标题关键词" />
      </Field>
      <ul className="pick-list">
        {paged.pageItems.map((e) => (
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
        {candidates.length === 0 && <li><Empty inline text="没有可添加的事件" /></li>}
      </ul>
      <Paginator paged={paged} />
    </Modal>
  );
}
