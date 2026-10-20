import { useMemo, useState } from 'react';
import { Modal, Field, TagInput } from './common';
import { EVENT_KINDS, createEvent, updateEvent } from '../core/repo/events';
import { listPersons } from '../core/repo/persons';
import { getTree, addMember, removeMember, collectionsOfEvent, type TreeNode } from '../core/repo/collections';
import type { Collection, DREvent, Participant } from '../core/types';
import { fromLocalInput, toLocalInput, type Precision, type TimeKind, type TimeSpec } from '../core/time';
import { bump } from '../store';

function flattenTree(node: TreeNode | null): { c: Collection; depth: number }[] {
  const result: { c: Collection; depth: number }[] = [];
  const walk = (n: TreeNode, d: number) => {
    result.push({ c: n, depth: d });
    for (const k of n.children) walk(k, d + 1);
  };
  if (node) walk(node, 0);
  return result;
}

export function EventForm({
  event,
  defaultPersonId,
  defaultCollectionId,
  onClose,
}: {
  event?: DREvent;
  defaultPersonId?: string;
  defaultCollectionId?: string;
  onClose: () => void;
}) {
  const persons = useMemo(() => listPersons({ includeArchived: true }), []);
  const tree = useMemo(() => getTree(), []);
  const flat = useMemo(() => flattenTree(tree), [tree]);
  const existingCols = useMemo(() => (event ? collectionsOfEvent(event.id).map((c) => c.id) : []), [event?.id]);

  const [title, setTitle] = useState(event?.title ?? '');
  const [kind, setKind] = useState(event?.kind ?? 'date');
  const [timeKind, setTimeKind] = useState<TimeKind>(event?.time.kind ?? 'instant');
  const [start, setStart] = useState(toLocalInput(event?.time.start ?? null));
  const [end, setEnd] = useState(toLocalInput(event?.time.end ?? null));
  const [precision, setPrecision] = useState(event?.time.precision ?? 'minute');
  const [raw, setRaw] = useState(event?.time.raw ?? '');
  const [placeName, setPlaceName] = useState(event?.place.name ?? '');
  const [content, setContent] = useState(event?.content ?? '');
  const [tags, setTags] = useState<string[]>(event?.tags ?? []);
  const [rating, setRating] = useState<number | ''>(event?.metrics.rating ?? '');
  const [cost, setCost] = useState<number | ''>(event?.metrics.cost ?? '');
  const [mood, setMood] = useState(event?.metrics.mood ?? '');
  const [intimacyDelta, setIntimacyDelta] = useState<number | ''>(event?.metrics.intimacyDelta ?? '');
  const [participantIds, setParticipantIds] = useState<string[]>(
    event?.participants.map((p) => p.personId) ?? (defaultPersonId ? [defaultPersonId] : []),
  );
  const [cols, setCols] = useState<string[]>(
    existingCols.length ? existingCols : defaultCollectionId ? [defaultCollectionId] : [],
  );

  const save = () => {
    const time: TimeSpec = {
      kind: timeKind,
      start: fromLocalInput(start),
      end: timeKind === 'interval' || timeKind === 'ongoing' ? fromLocalInput(end) : null,
      precision,
      raw: timeKind === 'fuzzy' ? raw : undefined,
    };
    const participants: Participant[] = participantIds.map((id) => ({ personId: id, role: 'primary' as const }));
    const payload = {
      title: title.trim() || '未命名事件',
      kind,
      time,
      place: { name: placeName || undefined },
      participants,
      content,
      tags,
      metrics: {
        rating: rating === '' ? undefined : Number(rating),
        cost: cost === '' ? undefined : Number(cost),
        currency: cost === '' ? undefined : 'CNY',
        mood: mood || undefined,
        intimacyDelta: intimacyDelta === '' ? undefined : Number(intimacyDelta),
      },
    };

    if (event) {
      updateEvent(event.id, payload);
      const before = new Set(existingCols);
      const after = new Set(cols);
      for (const id of after) if (!before.has(id)) addMember(id, 'event', event.id);
      for (const id of before) if (!after.has(id)) removeMember(id, 'event', event.id);
    } else {
      const created = createEvent(payload);
      for (const id of cols) addMember(id, 'event', created.id);
    }
    bump();
    onClose();
  };

  return (
    <Modal
      wide
      title={event ? '编辑事件' : '新建事件'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="标题">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：第一次一起看电影" />
        </Field>
        <Field label="类型">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {EVENT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="时间类型">
          <select value={timeKind} onChange={(e) => setTimeKind(e.target.value as TimeKind)}>
            <option value="instant">时刻</option>
            <option value="interval">区间</option>
            <option value="fuzzy">模糊时间</option>
            <option value="ongoing">进行中</option>
            <option value="unknown">时间未知</option>
          </select>
        </Field>
        <Field label="精度">
          <select value={precision} onChange={(e) => setPrecision((e.target.value as Precision) || 'minute')}>
            <option value="minute">分钟</option>
            <option value="hour">小时</option>
            <option value="day">天</option>
            <option value="month">月</option>
            <option value="year">年</option>
          </select>
        </Field>

        {timeKind !== 'unknown' && (
          <Field label="开始">
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
        )}
        {(timeKind === 'interval' || timeKind === 'ongoing') && (
          <Field label="结束">
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        )}
        {timeKind === 'fuzzy' && (
          <Field label="时间原文" hint="例如：去年夏天">
            <input value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="用户原话" />
          </Field>
        )}

        <Field label="地点">
          <input value={placeName} onChange={(e) => setPlaceName(e.target.value)} />
        </Field>
        <Field label="评分">
          <select value={rating} onChange={(e) => setRating(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">未评分</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {'★'.repeat(n)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="花费">
          <input type="number" value={cost} onChange={(e) => setCost(e.target.value === '' ? '' : Number(e.target.value))} />
        </Field>
        <Field label="心情">
          <input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="开心 / 平淡 / 低落" />
        </Field>

        <Field label="参与者">
          <div className="chip-group">
            {persons.map((p) => (
              <button
                key={p.id}
                type="button"
                className={participantIds.includes(p.id) ? 'chip chip-on' : 'chip'}
                onClick={() =>
                  setParticipantIds((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))
                }
              >
                {p.displayName}
              </button>
            ))}
            {persons.length === 0 && <span className="muted">还没有人物，先去「人物」页创建</span>}
          </div>
        </Field>
        <Field label="标签">
          <TagInput value={tags} onChange={setTags} />
        </Field>

        <Field label="所属事件集">
          <div className="chip-group">
            {flat.map(({ c, depth }) => (
              <button
                key={c.id}
                type="button"
                className={cols.includes(c.id) ? 'chip chip-on' : 'chip'}
                onClick={() => setCols((prev) => (prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]))}
              >
                {depth > 0 ? '　'.repeat(depth) + '└ ' : ''}
                {c.name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="亲密度增减">
          <input
            type="number"
            value={intimacyDelta}
            onChange={(e) => setIntimacyDelta(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </Field>

        <div className="span-2">
          <Field label="正文">
            <textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} placeholder="记录发生了什么…" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
