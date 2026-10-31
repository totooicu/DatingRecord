// 事件关联选择器（F-E08）：正向链接可增删，反向链接只读展示
import { useMemo, useState } from 'react';
import { formatCompact } from '../../core/time';
import { RELATION_LABELS, RELATION_TYPES } from '../../core/repo/events';
import type { RelatedEvent } from '../../core/types';
import { Field, Empty } from '../common';

export function RelatedField({
  selfId,
  related,
  onChange,
  candidates,
}: {
  /** 正在编辑的事件；新建时为空 */
  selfId?: string;
  related: RelatedEvent[];
  onChange: (list: RelatedEvent[]) => void;
  candidates: { id: string; title: string; startTs: number | null; relatedEvents?: RelatedEvent[] }[];
}) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  const titleOf = (id: string) => candidates.find((c) => c.id === id)?.title ?? '（已删除的事件）';

  const results = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return candidates
      .filter((c) => c.id !== selfId && !related.some((r) => r.targetId === c.id))
      .filter((c) => !kw || c.title.toLowerCase().includes(kw))
      .slice(0, 8);
  }, [candidates, q, related, selfId]);

  // 反向关联：别人的 relatedEvents 里指着当前事件的（只读）
  const incoming = useMemo(
    () =>
      candidates
        .filter((c) => c.id !== selfId)
        .flatMap((c) =>
          (c.relatedEvents ?? [])
            .filter((r) => r.targetId === selfId)
            .map((r) => ({ id: c.id, title: c.title, type: r.type })),
        ),
    [candidates, selfId],
  );

  const setType = (targetId: string, type: RelatedEvent['type']) =>
    onChange(related.map((r) => (r.targetId === targetId ? { ...r, type } : r)));

  const add = (targetId: string) => {
    onChange([...related, { type: 'followedBy', targetId }]);
    setQ('');
    setAdding(false);
  };

  return (
    <Field label="关联事件" hint="「后续 / 起因 / 同日」，用于串起一件事的前因后果">
      <div className="rel-list">
        {related.map((r) => (
          <div key={r.targetId} className="rel-row">
            <select
              className="rel-type"
              value={r.type}
              onChange={(e) => setType(r.targetId, e.target.value as RelatedEvent['type'])}
              aria-label="关系类型"
            >
              {RELATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RELATION_LABELS[t]}
                </option>
              ))}
            </select>
            <span className="rel-title" title={titleOf(r.targetId)}>
              {titleOf(r.targetId)}
            </span>
            <button
              type="button"
              className="rel-del"
              onClick={() => onChange(related.filter((x) => x.targetId !== r.targetId))}
              aria-label="移除关联"
            >
              ×
            </button>
          </div>
        ))}

        {adding ? (
          <div className="rel-add">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索事件标题…"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setAdding(false);
                if (e.key === 'Enter' && results.length) e.preventDefault();
              }}
            />
            <div className="rel-results">
              {results.map((c) => (
                <button key={c.id} type="button" className="rel-result" onClick={() => add(c.id)}>
                  <span className="rel-result-title">{c.title}</span>
                  <span className="muted">{c.startTs ? formatCompact(c.startTs, false) : '时间未知'}</span>
                </button>
              ))}
              {results.length === 0 && <Empty inline text="没有可关联的事件" />}
            </div>
          </div>
        ) : (
          <button type="button" className="rel-add-btn" onClick={() => setAdding(true)}>
            + 关联事件
          </button>
        )}
      </div>

      {incoming.length > 0 && (
        <div className="rel-incoming">
          <span className="muted">被以下事件关联：</span>
          {incoming.map((r) => (
            <span key={r.id} className="rel-incoming-item">
              {RELATION_LABELS[r.type]} · {r.title}
            </span>
          ))}
        </div>
      )}
    </Field>
  );
}
