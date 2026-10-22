// 事件表单字段网格
import { EVENT_KINDS } from '../../core/repo/events';
import { Field, TagInput } from '../common';
import { MarkdownEditor } from '../markdown';
import type { Collection, RelatedEvent } from '../../core/types';
import type { Precision, TimeKind } from '../../core/time';
import { RelatedField } from './RelatedField';
import type { EventDraft } from './draft';

const TIME_KINDS: { value: TimeKind; label: string }[] = [
  { value: 'instant', label: '时刻' },
  { value: 'interval', label: '区间' },
  { value: 'fuzzy', label: '模糊时间' },
  { value: 'ongoing', label: '进行中' },
  { value: 'unknown', label: '时间未知' },
];

const PRECISIONS: { value: Precision; label: string }[] = [
  { value: 'minute', label: '分钟' },
  { value: 'hour', label: '小时' },
  { value: 'day', label: '天' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
];

export function EventFields({
  d,
  patch,
  persons,
  flat,
  eventId,
  candidates,
}: {
  d: EventDraft;
  patch: (p: Partial<EventDraft>) => void;
  persons: { id: string; displayName: string }[];
  flat: { c: Collection; depth: number }[];
  /** 正在编辑的事件 id；新建时为 undefined */
  eventId?: string;
  candidates: { id: string; title: string; startTs: number | null; relatedEvents?: RelatedEvent[] }[];
}) {
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="form-grid">
      <Field label="标题">
        <input
          value={d.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="例如：第一次一起看电影"
        />
      </Field>
      <Field label="类型">
        <select value={d.kind} onChange={(e) => patch({ kind: e.target.value })}>
          {EVENT_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="时间类型">
        <select value={d.timeKind} onChange={(e) => patch({ timeKind: e.target.value as TimeKind })}>
          {TIME_KINDS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="精度">
        <select
          value={d.precision}
          onChange={(e) => patch({ precision: (e.target.value as Precision) || 'minute' })}
        >
          {PRECISIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      {d.timeKind !== 'unknown' && (
        <Field label="开始">
          <input type="datetime-local" value={d.start} onChange={(e) => patch({ start: e.target.value })} />
        </Field>
      )}
      {(d.timeKind === 'interval' || d.timeKind === 'ongoing') && (
        <Field label="结束">
          <input type="datetime-local" value={d.end} onChange={(e) => patch({ end: e.target.value })} />
        </Field>
      )}
      {d.timeKind === 'fuzzy' && (
        <Field label="时间原文" hint="例如：去年夏天">
          <input
            value={d.raw}
            onChange={(e) => patch({ raw: e.target.value })}
            placeholder="用户原话"
          />
        </Field>
      )}

      <Field label="地点">
        <input value={d.placeName} onChange={(e) => patch({ placeName: e.target.value })} />
      </Field>
      <Field label="评分">
        <select
          value={d.rating}
          onChange={(e) => patch({ rating: e.target.value === '' ? '' : Number(e.target.value) })}
        >
          <option value="">未评分</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {'★'.repeat(n)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="花费">
        <input
          type="number"
          value={d.cost}
          onChange={(e) => patch({ cost: e.target.value === '' ? '' : Number(e.target.value) })}
        />
      </Field>
      <Field label="心情">
        <input
          value={d.mood}
          onChange={(e) => patch({ mood: e.target.value })}
          placeholder="开心 / 平淡 / 低落"
        />
      </Field>

      <Field label="参与者">
        <div className="chip-group">
          {persons.map((p) => (
            <button
              key={p.id}
              type="button"
              className={d.participantIds.includes(p.id) ? 'chip chip-on' : 'chip'}
              onClick={() => patch({ participantIds: toggle(d.participantIds, p.id) })}
            >
              {p.displayName}
            </button>
          ))}
          {persons.length === 0 && <span className="muted">还没有人物，先去「人物」页创建</span>}
        </div>
      </Field>
      <Field label="标签">
        <TagInput value={d.tags} onChange={(tags) => patch({ tags })} />
      </Field>

      <Field label="所属事件集">
        <div className="chip-group">
          {flat.map(({ c }) => (
            <button
              key={c.id}
              type="button"
              className={d.cols.includes(c.id) ? 'chip chip-on' : 'chip'}
              // 不做层级缩进：多出来的左内边距在 chip 里就是一块空白，
              // 层级信息交给「事件集」页的树形结构，这里保持选项排布均匀
              onClick={() => patch({ cols: toggle(d.cols, c.id) })}
            >
              {c.name}
            </button>
          ))}
        </div>
      </Field>

      <div className="span-2">
        <RelatedField
          selfId={eventId}
          related={d.relatedEvents}
          onChange={(relatedEvents) => patch({ relatedEvents })}
          candidates={candidates}
        />
      </div>
      <Field label="亲密度增减">
        <input
          type="number"
          value={d.intimacyDelta}
          onChange={(e) =>
            patch({ intimacyDelta: e.target.value === '' ? '' : Number(e.target.value) })
          }
        />
      </Field>

      <div className="span-2">
        <Field label="正文">
          <MarkdownEditor value={d.content} onChange={(content) => patch({ content })} rows={6} />
        </Field>
      </div>
    </div>
  );
}
