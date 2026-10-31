// 事件浏览视图：只读、紧凑。
//
// 表单里的每个字段都占一整行，读的时候太散；这里把「事实类」字段
// （时间/类型/地点/评分/花费/心情/亲密度）收成一条会换行的小事实流，
// 人物/标签/事件集用只读 chip，正文才用完整宽度渲染 Markdown。
//
// 编辑仍然走 EventFields —— 浏览态只是同一份数据的另一种排版。
import type { ReactNode } from 'react';
import { EVENT_KINDS, RELATION_LABELS } from '../../core/repo/events';
import { formatTime } from '../../core/time';
import { MarkdownView } from '../markdown';
import type { Collection, DREvent } from '../../core/types';
import { Empty } from '../common';

export function EventView({
  event,
  persons,
  flat,
  collectionIds,
  candidates,
  body,
  missingTitle = '（已删除）',
}: {
  event: DREvent;
  persons: { id: string; displayName: string }[];
  flat: { c: Collection; depth: number }[];
  collectionIds: string[];
  candidates: { id: string; title: string }[];
  /** 正文区替换内容：聊天形式用它换成对话流，其余元数据照旧 */
  body?: ReactNode;
  /** 关联事件不在当前数据里时的占位文字：分享预览里是「没带进来」而不是「已删除」 */
  missingTitle?: string;
}) {
  const personName = new Map(persons.map((p) => [p.id, p.displayName]));
  const collectionName = new Map(flat.map(({ c }) => [c.id, c.name]));
  const titleOf = new Map(candidates.map((c) => [c.id, c.title]));
  const kindLabel = EVENT_KINDS.find((k) => k.value === event.kind)?.label ?? event.kind;

  const facts: { k: string; v: string; title?: string }[] = [];
  const add = (k: string, v: string | null | undefined, title?: string) => {
    if (v) facts.push({ k, v, title });
  };
  add('时间', formatTime(event.time));
  add('类型', kindLabel);
  add('地点', event.place.name);
  add('地址', event.place.address);
  if (event.place.geo) add('坐标', `${event.place.geo.lat.toFixed(6)}, ${event.place.geo.lng.toFixed(6)}`);
  add('评分', event.metrics.rating ? '★'.repeat(event.metrics.rating) : null);
  add(
    '花费',
    event.metrics.cost != null ? `¥${event.metrics.cost}` : null,
  );
  add('心情', event.metrics.mood);
  const delta = event.metrics.intimacyDelta;
  add('亲密度', delta ? (delta > 0 ? `+${delta}` : String(delta)) : null);

  const participants = event.participants.map((p) => ({
    id: p.personId,
    name: personName.get(p.personId) ?? '（已删除）',
    note: p.note,
  }));
  const cols = collectionIds
    .map((id) => ({ id, name: collectionName.get(id) }))
    .filter((c): c is { id: string; name: string } => !!c.name);
  const related = event.relatedEvents
    .map((r) => ({
      id: r.targetId,
      label: RELATION_LABELS[r.type] ?? r.type,
      title: titleOf.get(r.targetId) ?? missingTitle,
    }))
    .filter((r) => r.title);

  return (
    <div className="ev-view">
      <div className="ev-view-title-row">
        <h2 className="ev-view-title">{event.title || '未命名事件'}</h2>
        {event.isPrivate && <span className="ev-view-private">隐私</span>}
      </div>

      {facts.length > 0 && (
        <div className="ev-facts">
          {facts.map((f) => (
            <span key={f.k} className="ev-fact" title={f.title}>
              <em>{f.k}</em>
              {f.v}
            </span>
          ))}
        </div>
      )}

      {participants.length > 0 && (
        <div className="ev-line">
          <span className="ev-line-label">人物</span>
          <span className="ev-chips">
            {participants.map((p) => (
              <span key={p.id} className="ev-chip" title={p.note}>
                {p.name}
              </span>
            ))}
          </span>
        </div>
      )}

      {cols.length > 0 && (
        <div className="ev-line">
          <span className="ev-line-label">事件集</span>
          <span className="ev-chips">
            {cols.map((c) => (
              <span key={c.id} className="ev-chip">
                {c.name}
              </span>
            ))}
          </span>
        </div>
      )}

      {event.tags.length > 0 && (
        <div className="ev-line">
          <span className="ev-line-label">标签</span>
          <span className="ev-chips">
            {event.tags.map((t) => (
              <span key={t} className="ev-chip ev-chip-tag">
                #{t}
              </span>
            ))}
          </span>
        </div>
      )}

      {related.length > 0 && (
        <div className="ev-line">
          <span className="ev-line-label">关联</span>
          <span className="ev-chips">
            {related.map((r) => (
              <span key={r.id} className="ev-chip">
                <em className="ev-chip-kind">{r.label}</em>
                {r.title}
              </span>
            ))}
          </span>
        </div>
      )}

      <div className="ev-view-body">
        {body ??
          (event.content.trim() ? (
            <MarkdownView source={event.content} />
          ) : (
            <Empty compact text="还没有正文。" />
          ))}
      </div>
    </div>
  );
}
