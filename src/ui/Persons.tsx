import { useMemo, useState } from 'react';
import {
  createPerson,
  deletePerson,
  getPerson,
  listDefs,
  listPersons,
  setAttribute,
  statsOf,
  updatePerson,
} from '../core/repo/persons';
import { listEvents } from '../core/repo/events';
import { AttributeField, formatAttrValue } from './AttributeField';
import { ConfirmButton, Empty, TagInput } from './common';
import { formatTime, relativeDays } from '../core/time';
import { useVersion, bump } from '../store';
import { EventForm } from './EventForm';
import type { AttributeDef } from '../core/types';

export function PersonList({
  selectedId,
  onSelect,
  keyword,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  keyword: string;
}) {
  const v = useVersion();
  const persons = useMemo(() => listPersons({ keyword }), [v, keyword]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const p = createPerson({ displayName: n });
    bump();
    setName('');
    setCreating(false);
    onSelect(p.id);
  };

  return (
    <div className="side-list">
      <div className="side-head">
        <strong>人物</strong>
        <button className="icon-btn" onClick={() => setCreating(true)} title="新建人物">
          ＋
        </button>
      </div>
      {creating && (
        <div className="inline-create">
          <input
            autoFocus
            value={name}
            placeholder="姓名"
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
      {persons.length === 0 && <div className="muted pad">暂无人物</div>}
      {persons.map((p) => (
        <button
          key={p.id}
          className={p.id === selectedId ? 'side-item side-item-on' : 'side-item'}
          onClick={() => onSelect(p.id)}
        >
          <span className="avatar">{p.displayName.slice(0, 1)}</span>
          <span className="side-item-main">
            <span className="side-item-title">{p.displayName}</span>
            <span className="side-item-sub">
              {p.stats.eventCount} 次事件
              {p.stats.lastMeetTs ? ` · ${relativeDays(new Date(p.stats.lastMeetTs).toISOString())}` : ''}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function PersonDetail({ id }: { id: string }) {
  const v = useVersion();
  const person = useMemo(() => getPerson(id), [id, v]);
  const defs = useMemo(() => listDefs(), [v]);
  const stats = useMemo(() => statsOf(id), [id, v]);
  const events = useMemo(() => listEvents({ personId: id }), [id, v]);
  const [adding, setAdding] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [newEvent, setNewEvent] = useState(false);

  if (!person) return <Empty text="人物不存在或已删除" />;

  const groups = Array.from(new Set(defs.map((d) => d.group)));
  const usedKeys = Object.keys(person.attrs);
  const unusedDefs = defs.filter((d) => !usedKeys.includes(d.key));

  const setVal = (def: AttributeDef, value: unknown) => {
    setAttribute(id, def.key, value);
    bump();
  };

  return (
    <div className="detail">
      <div className="detail-head">
        <span className="avatar avatar-lg">{person.displayName.slice(0, 1)}</span>
        <div className="detail-head-main">
          <input
            className="title-input"
            value={person.displayName}
            onChange={(e) => updatePerson(id, { displayName: e.target.value })}
            onBlur={() => bump()}
          />
          <TagInput
            value={person.tags}
            onChange={(t) => {
              updatePerson(id, { tags: t });
              bump();
            }}
            placeholder="添加标签"
          />
        </div>
        <div className="detail-head-actions">
          <button className="btn btn-primary" onClick={() => setNewEvent(true)}>
            记一件事
          </button>
          <ConfirmButton
            text="归档"
            confirmText="确认归档？"
            onConfirm={() => {
              deletePerson(id);
              bump();
            }}
          />
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <span className="stat-num">{stats.eventCount}</span>
          <span className="stat-label">事件</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{stats.lastMeetTs ? relativeDays(new Date(stats.lastMeetTs).toISOString()) : '—'}</span>
          <span className="stat-label">最近见面</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">¥{stats.totalCost.toFixed(0)}</span>
          <span className="stat-label">总花费</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{stats.avgRating ? stats.avgRating.toFixed(1) : '—'}</span>
          <span className="stat-label">平均评分</span>
        </div>
      </div>

      {groups.map((g) => (
        <section key={g} className="card">
          <h4 className="card-title">{g || '未分组'}</h4>
          <div className="attr-grid">
            {defs
              .filter((d) => d.group === g)
              .map((d) => (
                <div key={d.key} className="attr-row">
                  <span className="attr-label">
                    {d.label}
                    {d.sensitive && <em className="badge">敏感</em>}
                    {d.timeVarying && <em className="badge badge-2">随时间</em>}
                  </span>
                  <div className="attr-control">
                    <AttributeField def={d} value={person.attrs[d.key]?.v} onChange={(val) => setVal(d, val)} />
                  </div>
                  {person.attrs[d.key]?.note && <span className="attr-note">{person.attrs[d.key].note}</span>}
                </div>
              ))}
          </div>
        </section>
      ))}

      <section className="card">
        <div className="card-head">
          <h4 className="card-title">自定义字段</h4>
          {unusedDefs.length > 0 && (
            <button className="btn btn-sm" onClick={() => setAdding((s) => !s)}>
              {adding ? '取消' : '＋ 添加字段'}
            </button>
          )}
        </div>
        {adding && (
          <div className="chip-group">
            {unusedDefs.map((d) => (
              <button
                key={d.key}
                className="chip"
                onClick={() => {
                  setAttribute(id, d.key, d.type === 'boolean' ? false : '');
                  bump();
                  setAdding(false);
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
        {unusedDefs.length === 0 && <p className="muted">所有已定义的字段都已添加。可在「设置 → 属性字典」新建字段。</p>}
      </section>

      <section className="card">
        <div className="card-head">
          <h4 className="card-title">相关事件（{events.length}）</h4>
        </div>
        {events.length === 0 && <p className="muted">还没有和 TA 的事件</p>}
        <ul className="event-list">
          {events.map((e) => (
            <li key={e.id}>
              <button className="event-item" onClick={() => setEditingEventId(e.id)}>
                <span className="event-time">{formatTime(e.time)}</span>
                <span className="event-title">{e.title}</span>
                <span className="event-meta">
                  {e.metrics.rating ? '★'.repeat(e.metrics.rating) : ''}
                  {e.metrics.cost ? ` ¥${e.metrics.cost}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {newEvent && <EventForm defaultPersonId={id} onClose={() => { setNewEvent(false); bump(); }} />}
      {editingEventId && (
        <EventForm
          event={listEvents({ personId: id }).find((e) => e.id === editingEventId)}
          onClose={() => {
            setEditingEventId(null);
            bump();
          }}
        />
      )}
    </div>
  );
}

export { formatAttrValue };
