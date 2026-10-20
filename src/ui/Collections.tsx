import { useEffect, useMemo, useState } from 'react';
import {
  addMember,
  createCollection,
  deleteCollection,
  getBreadcrumb,
  getCollection,
  getRoot,
  getTree,
  listChildren,
  listMembers,
  moveCollection,
  moveMemberTo,
  removeMember,
  updateCollection,
  type TreeNode,
} from '../core/repo/collections';
import { getEvent, listEvents } from '../core/repo/events';
import { getPerson } from '../core/repo/persons';
import { ConfirmButton, Empty, Modal, Field } from './common';
import { formatTime } from '../core/time';
import { useVersion, bump } from '../store';
import { EventForm } from './EventForm';

export function CollectionTree({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const v = useVersion();
  const tree = useMemo(() => getTree(), [v]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  if (!tree) return <div className="muted pad">暂无事件集</div>;

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const c = createCollection({ name: n, parentId: selectedId ?? tree.id });
    bump();
    setName('');
    setCreating(false);
    onSelect(c.id);
  };

  const render = (node: TreeNode, depth: number): JSX.Element => {
    const isCollapsed = collapsed[node.id];
    return (
      <div key={node.id}>
        <div className={node.id === selectedId ? 'tree-row tree-row-on' : 'tree-row'} style={{ paddingLeft: 8 + depth * 14 }}>
          <button
            className="tree-toggle"
            onClick={() => setCollapsed((s) => ({ ...s, [node.id]: !s[node.id] }))}
            disabled={node.children.length === 0}
          >
            {node.children.length ? (isCollapsed ? '▸' : '▾') : '·'}
          </button>
          <button className="tree-name" onClick={() => onSelect(node.id)}>
            {node.name}
            {node.eventCount > 0 && <em>{node.eventCount}</em>}
          </button>
        </div>
        {!isCollapsed && node.children.map((c) => render(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="side-list">
      <div className="side-head">
        <strong>事件集</strong>
        <button className="icon-btn" onClick={() => setCreating(true)} title="新建事件集">
          ＋
        </button>
      </div>
      {creating && (
        <div className="inline-create">
          <input
            autoFocus
            value={name}
            placeholder="名称"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') setCreating(false);
            }}
          />
          <button className="btn btn-primary btn-sm" onClick={submit}>
            创建
          </button>
        </div>
      )}
      {render(tree, 0)}
    </div>
  );
}

export function CollectionDetail({ id }: { id: string }) {
  const v = useVersion();
  const collection = useMemo(() => getCollection(id), [id, v]);
  const members = useMemo(() => listMembers(id), [id, v]);
  const children = useMemo(() => listChildren(id), [id, v]);
  const breadcrumb = useMemo(() => getBreadcrumb(id), [id, v]);
  const allEvents = useMemo(() => listEvents(), [v]);
  const tree = useMemo(() => getTree(), [v]);

  const [addOpen, setAddOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [kw, setKw] = useState('');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (msg) {
      const t = setTimeout(() => setMsg(null), 2500);
      return () => clearTimeout(t);
    }
  }, [msg]);

  if (!collection) return <Empty text="事件集不存在或已删除" />;

  const flatten = (n: TreeNode | null, out: { id: string; name: string; depth: number }[] = [], d = 0) => {
    if (!n) return out;
    out.push({ id: n.id, name: n.name, depth: d });
    for (const c of n.children) flatten(c, out, d + 1);
    return out;
  };
  const flat = flatten(tree);

  const memberEvents = members.filter((m) => m.memberType === 'event');
  const memberIds = new Set(members.map((m) => m.memberId));
  const candidates = allEvents.filter((e) => !memberIds.has(e.id) && (kw ? e.title.includes(kw) : true)).slice(0, 50);

  return (
    <div className="detail">
      <div className="breadcrumb">
        {breadcrumb.map((b, i) => (
          <span key={b.id}>
            {i > 0 && <em>/</em>}
            {b.name}
          </span>
        ))}
      </div>

      <div className="detail-head">
        <div className="detail-head-main">
          <input
            className="title-input"
            value={collection.name}
            onChange={(e) => updateCollection(id, { name: e.target.value })}
            onBlur={() => bump()}
          />
          <input
            className="sub-input"
            placeholder="描述（可选）"
            value={collection.description}
            onChange={(e) => updateCollection(id, { description: e.target.value })}
            onBlur={() => bump()}
          />
        </div>
        <div className="detail-head-actions">
          <select
            value={collection.status}
            onChange={(e) => {
              updateCollection(id, { status: e.target.value as typeof collection.status });
              bump();
            }}
          >
            <option value="ongoing">进行中</option>
            <option value="finished">已结束</option>
            <option value="archived">已归档</option>
          </select>
          <button className="btn" onClick={() => setMoveOpen(true)}>
            移动
          </button>
          {!collection.isRoot && (
            <ConfirmButton
              text="删除"
              danger
              confirmText="确认删除？（不会删除事件本身）"
              onConfirm={() => {
                const r = deleteCollection(id);
                if (!r.ok) setMsg(r.reason ?? '删除失败');
                bump();
              }}
            />
          )}
        </div>
      </div>

      {msg && <div className="alert">{msg}</div>}

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

      <section className="card">
        <div className="card-head">
          <h4 className="card-title">成员（{members.length}）</h4>
          <button className="btn btn-sm btn-primary" onClick={() => setAddOpen(true)}>
            ＋ 添加事件
          </button>
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
                <button className="member-title" onClick={() => ev && setEditingEventId(ev.id)}>
                  {title}
                </button>
                {ev && <span className="muted">{formatTime(ev.time)}</span>}
                {ev && ev.participants[0] && (
                  <span className="muted">{getPerson(ev.participants[0].personId)?.displayName ?? ''}</span>
                )}
                <span className="member-actions">
                  <button
                    className="icon-btn"
                    title="上移"
                    onClick={() => {
                      moveMemberTo(id, m.memberType, m.memberId, i - 1);
                      bump();
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    title="下移"
                    onClick={() => {
                      moveMemberTo(id, m.memberType, m.memberId, i + 2);
                      bump();
                    }}
                  >
                    ↓
                  </button>
                  <button
                    className="icon-btn"
                    title="移出集合（不删除事件）"
                    onClick={() => {
                      removeMember(id, m.memberType, m.memberId);
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
        {memberEvents.length > 0 && (
          <p className="muted small">共 {memberEvents.length} 个事件；排序键为字符串（fractional index），跨端合并不会错乱。</p>
        )}
      </section>

      {addOpen && (
        <Modal title="添加事件到集合" onClose={() => setAddOpen(false)}>
          <Field label="搜索事件">
            <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="输入标题关键词" />
          </Field>
          <ul className="pick-list">
            {candidates.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => {
                    addMember(id, 'event', e.id);
                    bump();
                    setAddOpen(false);
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
      )}

      {moveOpen && (
        <Modal
          title="移动到…"
          onClose={() => setMoveOpen(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setMoveOpen(false)}>
                取消
              </button>
            </>
          }
        >
          <ul className="pick-list">
            {flat
              .filter((f) => f.id !== id)
              .map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() => {
                      const r = moveCollection(id, f.id === getRoot()?.id ? f.id : f.id);
                      if (!r.ok) setMsg(r.reason ?? '移动失败');
                      bump();
                      setMoveOpen(false);
                    }}
                  >
                    {'　'.repeat(f.depth)}
                    {f.name}
                  </button>
                </li>
              ))}
          </ul>
        </Modal>
      )}

      {editingEventId && (
        <EventForm
          event={allEvents.find((e) => e.id === editingEventId)}
          onClose={() => {
            setEditingEventId(null);
            bump();
          }}
        />
      )}
    </div>
  );
}
