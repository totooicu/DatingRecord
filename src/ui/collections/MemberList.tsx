// 成员列表：事件/子集合混排，支持上移下移与移出
import { getCollection, listMembers, moveMemberTo, removeMember } from '../../core/repo/collections';
import { getEvent } from '../../core/repo/events';
import { getPerson } from '../../core/repo/persons';
import { bump } from '../../store';
import { formatTime } from '../../core/time';
import type { MemberItem } from '../../core/repo/collections';

export function MemberList({
  collectionId,
  members,
  onEditEvent,
  onAdd,
  onNew,
  templateEventId,
}: {
  collectionId: string;
  members: MemberItem[];
  onEditEvent: (id: string) => void;
  /** 打开「添加已有事件」弹窗 */
  onAdd: () => void;
  /** 直接在本集合下新建事件：会带上集合 id 与模板事件 */
  onNew?: () => void;
  /** 当前模板事件 id：成员行上打「模板」标记 */
  templateEventId?: string | null;
}) {
  const eventCount = members.filter((m) => m.memberType === 'event').length;

  return (
    <section className="card">
      <div className="card-head">
        <h4 className="card-title">成员（{members.length}）</h4>
        <div className="card-head-actions">
          {onNew && (
            <button className="btn btn-sm btn-primary" onClick={onNew}>
              ＋ 新建事件
            </button>
          )}
          <button className="btn btn-sm" onClick={onAdd}>
            添加已有
          </button>
        </div>
      </div>
      {members.length === 0 && <p className="muted">还没有成员。成员可以是事件，也可以是子事件集。</p>}
      <ul className="member-list">
        {members.map((m, i) => {
          const ev = m.memberType === 'event' ? getEvent(m.memberId) : null;
          const col = m.memberType === 'collection' ? getCollection(m.memberId) : null;
          const title = ev ? ev.title : col ? col.name : '(已删除)';
          return (
            <li key={`${m.memberType}-${m.memberId}`}>
              <span className="member-type">{m.memberType === 'event' ? '事件' : '集合'}</span>
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
                    moveMemberTo(collectionId, m.memberType, m.memberId, i - 1);
                    bump();
                  }}
                >
                  ↑
                </button>
                <button
                  className="icon-btn"
                  title="下移"
                  onClick={() => {
                    moveMemberTo(collectionId, m.memberType, m.memberId, i + 2);
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
      {eventCount > 0 && (
        <p className="muted small">
          共 {eventCount} 个事件；排序键为字符串（fractional index），跨端合并不会错乱。
        </p>
      )}
    </section>
  );
}

export function ChildList({ children }: { children: { id: string; name: string }[] }) {
  return (
    <section className="card">
      <div className="card-head">
        <h4 className="card-title">子事件集（{children.length}）</h4>
      </div>
      {children.length === 0 ? (
        <p className="muted">暂无子事件集。事件集可无限嵌套。</p>
      ) : (
        <ul className="plain-list">
          {children.map((c) => (
            <li key={c.id}>
              <span className="tree-name">{c.name}</span>
              <span className="muted">{listMembers(c.id).length} 个成员</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
