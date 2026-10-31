// 事件列表：只列事件，按手动顺序排列，支持上移下移与移出。
//
// 子事件集不混进来——它们在上面的「子事件集」卡片里，标题和计数才对得上
// 旁边的表格视图（表格也只列事件）。
import { useMemo } from 'react';
import { getCollection, listMembers, moveMemberTo, removeMember } from '../../core/repo/collections';
import { getEvent } from '../../core/repo/events';
import { getPerson } from '../../core/repo/persons';
import { bump } from '../../store';
import { formatTime } from '../../core/time';
import { usePaged } from '../common/usePaged';
import { Paginator } from '../common/Paginator';
import { usePageSize } from '../prefs';
import type { MemberItem } from '../../core/repo/collections';
import type { CollectionView } from '../prefs';
import { EventViewToggle } from './EventViewToggle';

export function MemberList({
  collectionId,
  members,
  view,
  onView,
  onEditEvent,
  onAdd,
  onNew,
  templateEventId,
}: {
  collectionId: string;
  members: MemberItem[];
  view: CollectionView;
  onView: (v: CollectionView) => void;
  onEditEvent: (id: string) => void;
  /** 打开「添加已有事件」弹窗 */
  onAdd: () => void;
  /** 直接在本集合下新建事件：会带上集合 id 与模板事件 */
  onNew?: () => void;
  /** 当前模板事件 id：成员行上打「模板」标记 */
  templateEventId?: string | null;
}) {
  // 留一份全长列表里的下标：moveMemberTo 的 targetIndex 是按完整成员表算的
  const eventRows = useMemo(
    () =>
      members
        .map((member, fullIndex) => ({ member, fullIndex }))
        .filter(({ member }) => member.memberType === 'event'),
    [members],
  );
  // 一个集合几千条事件时不能整铺：分页控件与每页条数都跟人物列表那套共用
  const paged = usePaged(eventRows, usePageSize());

  return (
    <section className="card">
      <div className="card-head event-card-head">
        <h4 className="card-title">事件（{eventRows.length}）</h4>
        <EventViewToggle view={view} onChange={onView} />
      </div>
      <div className="event-toolbar">
        {onNew && (
          <button className="btn btn-sm btn-primary" onClick={onNew}>
            ＋ 新建事件
          </button>
        )}
        <button className="btn btn-sm" onClick={onAdd}>
          添加已有
        </button>
      </div>
      {eventRows.length === 0 && (
        <p className="muted">还没有事件。可以新建，也可以从已有事件里挑。</p>
      )}
      <ul className="member-list">
        {paged.pageItems.map(({ member: m, fullIndex }) => {
          const ev = getEvent(m.memberId);
          const title = ev ? ev.title : '(已删除)';
          return (
            <li key={`${m.memberType}-${m.memberId}`}>
              <span className="member-type">事件</span>
              {ev && templateEventId === ev.id && <span className="member-type">模板</span>}
              <div className="member-main">
                <button className="member-title" onClick={() => ev && onEditEvent(ev.id)}>
                  {title}
                </button>
                {ev && (
                  <div className="member-meta muted small">
                    <span>{formatTime(ev.time)}</span>
                    {ev.participants[0] && (
                      <>
                        <span>·</span>
                        <span>{getPerson(ev.participants[0].personId)?.displayName ?? ''}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <span className="member-actions">
                <button
                  className="icon-btn"
                  title="上移"
                  onClick={() => {
                    moveMemberTo(collectionId, m.memberType, m.memberId, fullIndex - 1);
                    bump();
                  }}
                >
                  ↑
                </button>
                <button
                  className="icon-btn"
                  title="下移"
                  onClick={() => {
                    moveMemberTo(collectionId, m.memberType, m.memberId, fullIndex + 2);
                    bump();
                  }}
                >
                  ↓
                </button>
                <button
                  className="icon-btn"
                  title="移出集合（不删除事件）"
                  onClick={() => {
                    removeMember(collectionId, m.memberType, m.memberId);
                    bump();
                  }}
                >
                  ×
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <Paginator paged={paged} />
      {eventRows.length > 0 && <p className="muted small">共 {eventRows.length} 个事件；↑↓ 调整顺序。</p>}
    </section>
  );
}

export function ChildList({
  children,
  memberCollections = [],
  onRemoveMember,
}: {
  children: { id: string; name: string }[];
  /** 通过成员关系挂进来的集合（不是 parent_id 子集），别让它们看不见 */
  memberCollections?: { id: string; name: string }[];
  onRemoveMember?: (collectionId: string) => void;
}) {
  // 同一个集合可能既是子集又是成员：按 id 去重，子集优先
  const rows = [
    ...children.map((c) => ({ ...c, viaMember: false })),
    ...memberCollections
      .filter((m) => !children.some((c) => c.id === m.id))
      .map((m) => ({ ...m, viaMember: true })),
  ];

  return (
    <section className="card">
      <div className="card-head">
        <h4 className="card-title">子事件集（{rows.length}）</h4>
      </div>
      {rows.length === 0 ? (
        <p className="muted">暂无子事件集。事件集可无限嵌套。</p>
      ) : (
        <ul className="plain-list">
          {rows.map((c) => (
            <li key={c.id}>
              <span className="tree-name">{getCollection(c.id)?.name ?? c.name}</span>
              <span className="muted">
                {listMembers(c.id).filter((m) => m.memberType === 'event').length} 个事件
              </span>
              {c.viaMember && onRemoveMember && (
                <button
                  className="icon-btn"
                  title="移出集合（不删除子集）"
                  onClick={() => onRemoveMember(c.id)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
