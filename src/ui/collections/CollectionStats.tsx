// 三格概览：直接事件 / 含子集合的事件 / 子事件集
import { descendantEventIds } from '../../core/repo/collections';
import { getEvent } from '../../core/repo/events';
import type { MemberItem } from '../../core/repo/collections';
import type { Collection } from '../../core/types';

export function CollectionStats({
  collectionId,
  members,
  children,
  smartCount,
}: {
  collectionId: string;
  members: MemberItem[];
  children: Collection[];
  /** 智能集合：直接事件数是规则现算出来的，不走成员表 */
  smartCount?: number;
}) {
  return (
    <div className="stat-row">
      <div className="stat-card">
        <span className="stat-num">{smartCount ?? members.filter((m) => m.memberType === 'event').length}</span>
        <span className="stat-label">{smartCount !== undefined ? '命中事件' : '直接事件'}</span>
      </div>
      <div className="stat-card">
        <span className="stat-num">
          {smartCount !== undefined ? smartCount : descendantEventIds(collectionId).filter((eid) => !!getEvent(eid)).length}
        </span>
        <span className="stat-label">{smartCount !== undefined ? '实时求值' : '含子集合的事件'}</span>
      </div>
      <div className="stat-card">
        <span className="stat-num">{children.length}</span>
        <span className="stat-label">子事件集</span>
      </div>
    </div>
  );
}
