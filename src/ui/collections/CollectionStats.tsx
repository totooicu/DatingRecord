// 三格概览：直接事件 / 含子集合的事件 / 子事件集
import { descendantEventIds } from '../../core/repo/collections';
import { getEvent } from '../../core/repo/events';
import type { MemberItem } from '../../core/repo/collections';
import type { Collection } from '../../core/types';

export function CollectionStats({
  collectionId,
  members,
  children,
}: {
  collectionId: string;
  members: MemberItem[];
  children: Collection[];
}) {
  return (
    <div className="stat-row">
      <div className="stat-card">
        <span className="stat-num">{members.filter((m) => m.memberType === 'event').length}</span>
        <span className="stat-label">直接事件</span>
      </div>
      <div className="stat-card">
        <span className="stat-num">
          {descendantEventIds(collectionId).filter((eid) => !!getEvent(eid)).length}
        </span>
        <span className="stat-label">含子集合的事件</span>
      </div>
      <div className="stat-card">
        <span className="stat-num">{children.length}</span>
        <span className="stat-label">子事件集</span>
      </div>
    </div>
  );
}
