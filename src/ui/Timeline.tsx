import { useMemo, useState } from 'react';
import { EVENT_KINDS, listEvents, listDeletedEvents, purgeEvent, restoreEvent } from '../core/repo/events';
import { listPersons } from '../core/repo/persons';
import { getTree, type TreeNode } from '../core/repo/collections';
import { EventForm } from './EventForm';
import { Empty, Modal, ConfirmButton } from './common';
import { formatCompact, formatTime } from '../core/time';
import { useVersion, bump } from '../store';
import type { DREvent } from '../core/types';

export interface TimelineFilter {
  keyword: string;
  personId: string;
  kind: string;
  tag: string;
  minRating: string;
  withinDays: string;
  collectionId: string;
}

export const defaultFilter: TimelineFilter = {
  keyword: '',
  personId: '',
  kind: '',
  tag: '',
  minRating: '',
  withinDays: '',
  collectionId: '',
};

export function TimelineFilters({
  filter,
  onChange,
}: {
  filter: TimelineFilter;
  onChange: (f: TimelineFilter) => void;
}) {
  const v = useVersion();
  const persons = useMemo(() => listPersons({ includeArchived: true }), [v]);
  const tree = useMemo(() => getTree(), [v]);

  const flat: { id: string; name: string; depth: number }[] = [];
  const walk = (n: TreeNode, d: number) => {
    flat.push({ id: n.id, name: n.name, depth: d });
    for (const c of n.children) walk(c, d + 1);
  };
  if (tree) walk(tree, 0);

  const set = (patch: Partial<TimelineFilter>) => onChange({ ...filter, ...patch });

  return (
    <div className="side-list">
      <div className="side-head">
        <strong>筛选</strong>
        <button className="icon-btn" onClick={() => onChange(defaultFilter)} title="重置">
          ↺
        </button>
      </div>
      <div className="filter-body">
        <label className="filter-item">
          <span>人物</span>
          <select value={filter.personId} onChange={(e) => set({ personId: e.target.value })}>
            <option value="">全部</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-item">
          <span>事件集</span>
          <select value={filter.collectionId} onChange={(e) => set({ collectionId: e.target.value })}>
            <option value="">全部</option>
            {flat.map((f) => (
              <option key={f.id} value={f.id}>
                {'　'.repeat(f.depth)}
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-item">
          <span>类型</span>
          <select value={filter.kind} onChange={(e) => set({ kind: e.target.value })}>
            <option value="">全部</option>
            {EVENT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-item">
          <span>评分 ≥</span>
          <select value={filter.minRating} onChange={(e) => set({ minRating: e.target.value })}>
            <option value="">不限</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={String(n)}>
                {n} 星
              </option>
            ))}
          </select>
        </label>
        <label className="filter-item">
          <span>时间范围</span>
          <select value={filter.withinDays} onChange={(e) => set({ withinDays: e.target.value })}>
            <option value="">全部</option>
            <option value="7">近 7 天</option>
            <option value="30">近 30 天</option>
            <option value="90">近 90 天</option>
            <option value="365">近一年</option>
          </select>
        </label>
        <label className="filter-item">
          <span>标签包含</span>
          <input value={filter.tag} onChange={(e) => set({ tag: e.target.value })} placeholder="如：电影" />
        </label>
      </div>
    </div>
  );
}

export function Timeline({ filter, keyword }: { filter: TimelineFilter; keyword: string }) {
  const v = useVersion();
  const persons = useMemo(() => listPersons({ includeArchived: true }), [v]);
  const nameOf = (id: string) => persons.find((p) => p.id === id)?.displayName ?? '?';

  const events = useMemo<DREvent[]>(() => {
    const from = filter.withinDays ? Date.now() - Number(filter.withinDays) * 86400000 : undefined;
    return listEvents({
      keyword: keyword || filter.keyword || undefined,
      personId: filter.personId || undefined,
      kind: filter.kind || undefined,
      tag: filter.tag || undefined,
      minRating: filter.minRating ? Number(filter.minRating) : undefined,
      fromTs: from,
      collectionId: filter.collectionId || undefined,
    });
  }, [v, filter, keyword]);

  const [editing, setEditing] = useState<DREvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, DREvent[]>();
    for (const e of events) {
      const key = e.startTs ? new Date(e.startTs).toISOString().slice(0, 7) : '时间未知';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries());
  }, [events]);

  return (
    <div className="timeline">
      <div className="timeline-head">
        <h3>
          时间线 <span className="muted">{events.length} 条</span>
        </h3>
        <div>
          <button className="btn btn-sm" onClick={() => setTrashOpen(true)}>
            回收站
          </button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            ＋ 记一件事
          </button>
        </div>
      </div>

      {events.length === 0 && <Empty text="没有符合条件的事件" />}

      {groups.map(([month, list]) => (
        <section key={month} className="month-group">
          <div className="month-label">{month === '时间未知' ? '时间未知' : month.replace('-', ' 年 ') + ' 月'}</div>
          <ul className="event-list">
            {list.map((e) => (
              <li key={e.id}>
                <button className="event-item" onClick={() => setEditing(e)}>
                  <span className="event-time" title={formatTime(e.time)}>
                    {formatCompact(e.startTs, e.time.allDay === true || e.time.precision === 'day')}
                    {e.time.kind === 'fuzzy' && ' ~'}
                  </span>
                  <span className="event-title">{e.title}</span>
                  <span className="event-people">{e.participants.map((p) => nameOf(p.personId)).join('、')}</span>
                  <span className="event-meta">
                    {e.metrics.rating ? '★'.repeat(e.metrics.rating) : ''}
                    {e.metrics.cost ? ` ¥${e.metrics.cost}` : ''}
                    {e.tags.length ? ` #${e.tags.join(' #')}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {editing && (
        <EventForm
          event={editing}
          onClose={() => {
            setEditing(null);
            bump();
          }}
        />
      )}
      {creating && (
        <EventForm
          onClose={() => {
            setCreating(false);
            bump();
          }}
        />
      )}

      {trashOpen && (
        <Modal title="回收站（软删除的事件）" onClose={() => setTrashOpen(false)} wide>
          <ul className="member-list">
            {listDeletedEvents().map((e) => (
              <li key={e.id}>
                <span className="member-type">已删除</span>
                <span className="member-title">{e.title}</span>
                <span className="member-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      restoreEvent(e.id);
                      bump();
                    }}
                  >
                    恢复
                  </button>
                  <ConfirmButton
                    text="彻底删除"
                    danger
                    confirmText="确认彻底删除？"
                    onConfirm={() => {
                      purgeEvent(e.id);
                      bump();
                    }}
                  />
                </span>
              </li>
            ))}
            {listDeletedEvents().length === 0 && <li className="muted">回收站是空的</li>}
          </ul>
        </Modal>
      )}
    </div>
  );
}
