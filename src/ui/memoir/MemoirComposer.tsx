// 新建回忆：挑事件 + 时间范围，然后拍快照。
//
// 这里刻意只做「选」和「冻结」：选完那一刻的事件 id 就是这本回忆录的全部
// 素材，之后集合里新加的事件不会自己长进来（见 core/types/memoir.ts 的说明）。

import { useEffect, useMemo, useState } from 'react';
import { collectionEventOptions, createMemoir, inScopeTime } from '../../core/repo/memoirs';
import { formatTime } from '../../core/time';
import { hides } from '../../privacy';
import type { Memoir } from '../../core/types';
import { Empty } from '../common';

export function MemoirComposer({
  collectionId,
  collectionName,
  onCancel,
  onCreated,
}: {
  collectionId: string;
  collectionName: string;
  onCancel: () => void;
  onCreated: (m: Memoir) => void;
}) {
  const all = useMemo(() => collectionEventOptions(collectionId).filter((e) => !hides(e)), [collectionId]);
  const [title, setTitle] = useState(`${collectionName}回忆`);
  const [subtitle, setSubtitle] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const inRange = useMemo(
    () => all.filter((e) => inScopeTime(e, { from: from || null, to: to || null })),
    [all, from, to],
  );

  // 改范围就按新范围重新预选；用户再手动增减
  useEffect(() => {
    setPicked(new Set(inRange.map((e) => e.id)));
  }, [inRange]);

  const toggle = (id: string) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = () => {
    const events = inRange.filter((e) => picked.has(e.id));
    if (!events.length) return;
    const m = createMemoir({
      collectionId,
      title,
      subtitle,
      events,
      scope: {
        eventIds: events.map((e) => e.id),
        from: from || null,
        to: to || null,
        frozenAt: new Date().toISOString(),
      },
    });
    onCreated(m);
  };

  return (
    <section className="memoir-compose">
      <div className="memoir-toolbar">
        <button className="btn btn-sm" onClick={onCancel}>
          ← 返回
        </button>
        <span className="muted small">选好的事件会冻结成快照，之后新加的事件需要手动扫描。</span>
      </div>

      <div className="memoir-field">
        <label className="muted small">标题</label>
        <input className="music-name-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="memoir-field">
        <label className="muted small">副标题（可选）</label>
        <input
          className="music-name-input"
          value={subtitle}
          placeholder="例如：第一次一起出远门"
          onChange={(e) => setSubtitle(e.target.value)}
        />
      </div>

      <div className="memoir-range">
        <label className="muted small">
          从
          <input type="date" className="memoir-date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="muted small">
          到
          <input type="date" className="memoir-date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <span className="muted small">不填 = 不限</span>
      </div>

      <div className="memoir-pick-head">
        <strong>参与的事件（{picked.size}/{inRange.length}）</strong>
        <span>
          <button className="btn btn-sm" onClick={() => setPicked(new Set(inRange.map((e) => e.id)))}>
            全选
          </button>
          <button className="btn btn-sm" onClick={() => setPicked(new Set())}>
            全不选
          </button>
        </span>
      </div>

      {inRange.length === 0 ? (
        <Empty text="这个范围里没有事件。放宽时间范围，或先往事件集里加几条。" />
      ) : (
        <ul className="memoir-pick-list">
          {inRange.map((e) => (
            <li key={e.id} className={picked.has(e.id) ? 'memoir-pick on' : 'memoir-pick'}>
              <label>
                <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
                <span className="memoir-pick-time">{formatTime(e.time)}</span>
                <span className="memoir-pick-title">{e.title || '未命名事件'}</span>
                {e.place.name && <span className="muted small">{e.place.name}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="memoir-toolbar memoir-create-bar">
        <button className="btn btn-primary" disabled={picked.size === 0} onClick={create}>
          创建回忆（{picked.size} 个事件）
        </button>
      </div>
    </section>
  );
}
