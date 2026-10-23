// 事件相关工具。

import type { ToolDef } from './types';
import {
  listEvents,
  getEvent,
  listDeletedEvents,
  globalStats,
  EVENT_KINDS,
  type EventFilter,
} from '../repo/events';
import { createEvent, updateEvent, deleteEvent, restoreEvent, purgeEvent, setEventPrivate, type EventInput } from '../repo/events/write';
import { listPersons } from '../repo/persons';
import type { DREvent, Participant } from '../types';
import type { TimeSpec } from '../time';

/**
 * 把 AI / CLI 传进来的时间统一成 TimeSpec。
 * 接受三种写法：
 *   "2024-05-01"            → 精确到天的时刻
 *   "2024-05-01T14:30"      → 精确到分的时刻
 *   "去年夏天"               → 模糊时间（保留原文）
 * 也接受已经是一个 TimeSpec 对象的情况（原样透传）。
 */
export function toTimeSpec(v: unknown): TimeSpec {
  if (v && typeof v === 'object') return v as TimeSpec;
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return { kind: 'unknown' };
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
    return { kind: 'instant', start: new Date(t).toISOString(), precision: dayOnly ? 'day' : 'minute' };
  }
  return { kind: 'fuzzy', raw: s };
}

/** 列表场合的摘要：正文只留开头，避免把整库灌进模型上下文 */
function brief(e: DREvent): Record<string, unknown> {
  return {
    id: e.id,
    title: e.title,
    kind: e.kind,
    viewMode: e.viewMode,
    start: e.startTs ? new Date(e.startTs).toISOString() : null,
    participants: e.participants.map((p) => p.personId),
    tags: e.tags,
    rating: e.metrics.rating ?? null,
    contentHead: e.content.slice(0, 120),
    isPrivate: e.isPrivate,
    deletedAt: e.deletedAt,
  };
}

/** 人物姓名速查：AI 拿到的是 id，回复用户时最好能说人名 */
function personNames(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of listPersons({ includeArchived: true })) out[p.id] = p.displayName;
  return out;
}

function tsOf(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return v;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? undefined : t;
}

/** 参与者入参：人物 id，或带角色/备注的对象 */
function toParticipants(v: unknown): Participant[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map((p) => {
    if (typeof p === 'string') return { personId: p, role: 'companion' as const };
    const o = p as Record<string, unknown>;
    return {
      personId: String(o.personId),
      role: (typeof o.role === 'string' ? o.role : 'companion') as Participant['role'],
      note: o.note as string | undefined,
    };
  });
}

export const EVENT_TOOLS: ToolDef[] = [
  {
    name: 'event.kinds',
    group: 'event',
    title: '事件类型字典',
    desc: '全部合法的事件 kind 值及中文标签',
    mutating: false,
    params: [],
    run: () => EVENT_KINDS,
  },
  {
    name: 'event.list',
    group: 'event',
    title: '列出事件',
    desc: '按条件筛选事件（人物/事件集/标签/关键词/类型/时间范围/评分），按开始时间倒序',
    mutating: false,
    params: [
      { name: 'personId', type: 'string', desc: '只看某人物参与的事件', required: false },
      { name: 'collectionId', type: 'string', desc: '只看某事件集（含子集）里的事件', required: false },
      { name: 'tag', type: 'string', desc: '按标签筛选', required: false },
      { name: 'keyword', type: 'string', desc: '标题/正文/标签模糊搜索', required: false },
      { name: 'kind', type: 'string', desc: '事件类型，见 event.kinds', required: false },
      { name: 'from', type: 'string', desc: '起始日期（含），如 2024-01-01', required: false },
      { name: 'to', type: 'string', desc: '截止日期（含）', required: false },
      { name: 'minRating', type: 'number', desc: '最低评分', required: false },
      { name: 'includeDeleted', type: 'boolean', desc: '包含已删除（回收站里）的事件', required: false },
      { name: 'limit', type: 'number', desc: '最多返回几条，默认 50', required: false, default: 50 },
    ],
    run: (a) => {
      const filter: EventFilter = {
        personId: a.personId as string | undefined,
        collectionId: a.collectionId as string | undefined,
        tag: a.tag as string | undefined,
        keyword: a.keyword as string | undefined,
        kind: a.kind as string | undefined,
        fromTs: tsOf(a.from),
        toTs: tsOf(a.to),
        minRating: a.minRating === undefined ? undefined : Number(a.minRating),
        includeDeleted: a.includeDeleted === true,
      };
      const limit = a.limit === undefined ? 50 : Number(a.limit);
      const events = listEvents(filter).map(brief);
      return { count: events.length, truncated: events.length > limit, events: events.slice(0, limit) };
    },
  },
  {
    name: 'event.get',
    group: 'event',
    title: '事件详情',
    desc: '按 id 取单个事件：完整正文、地点、参与者、指标、关联事件',
    mutating: false,
    params: [{ name: 'id', type: 'string', desc: '事件 id（e 开头）', required: true }],
    run: (a) => {
      const e = getEvent(a.id as string);
      if (!e) throw new Error(`事件不存在：${a.id}`);
      return { ...e, personNames: personNames() };
    },
  },
  {
    name: 'event.create',
    group: 'event',
    title: '新建事件',
    desc: '记一件事。participants 传人物 id 数组（可带 role）。时间可省略，省略记为「时间未知」',
    mutating: true,
    params: [
      { name: 'title', type: 'string', desc: '标题', required: true },
      { name: 'kind', type: 'string', desc: '事件类型，见 event.kinds，默认 note', required: false, default: 'note' },
      { name: 'time', type: 'string', desc: '时间：ISO 日期/日期时间，或自然语言（如「上周三」）', required: false },
      { name: 'end', type: 'string', desc: '结束时间（区间事件）', required: false },
      { name: 'place', type: 'object', desc: '地点 {name,address}', required: false },
      {
        name: 'participants',
        type: 'array',
        desc: '参与者：人物 id 数组，或 [{personId,role,note}]。role ∈ primary/companion/thirdParty/self',
        required: false,
      },
      { name: 'content', type: 'string', desc: '正文（支持 Markdown）', required: false },
      { name: 'tags', type: 'array', desc: '标签数组', required: false },
      { name: 'rating', type: 'number', desc: '评分 1-5', required: false },
      { name: 'cost', type: 'number', desc: '花费金额', required: false },
      { name: 'mood', type: 'string', desc: '心情', required: false },
      { name: 'viewMode', type: 'string', desc: 'doc=正文, chat=聊天形式', required: false, enum: ['doc', 'chat'] },
      { name: 'primaryCollectionId', type: 'string', desc: '所属事件集 id', required: false },
    ],
    run: (a) => {
      const time = toTimeSpec(a.time);
      if (a.end) time.end = new Date(Date.parse(String(a.end))).toISOString();
      const rawParts = a.participants;
      const participants = toParticipants(rawParts);
      const metrics: NonNullable<EventInput['metrics']> = {};
      if (a.rating !== undefined) metrics.rating = Number(a.rating);
      if (a.cost !== undefined) metrics.cost = Number(a.cost);
      if (a.mood !== undefined) metrics.mood = String(a.mood);
      const input: EventInput = {
        title: a.title as string,
        kind: (a.kind as string) ?? 'note',
        time,
        place: (a.place as EventInput['place']) ?? undefined,
        participants: participants as EventInput['participants'],
        content: a.content as string | undefined,
        tags: (a.tags as string[] | undefined) ?? undefined,
        metrics: Object.keys(metrics).length ? metrics : undefined,
        viewMode: (a.viewMode as EventInput['viewMode']) ?? undefined,
        primaryCollectionId: (a.primaryCollectionId as string | null | undefined) ?? null,
      };
      const e = createEvent(input);
      return { id: e.id, title: e.title, start: e.startTs ? new Date(e.startTs).toISOString() : null };
    },
  },
  {
    name: 'event.update',
    group: 'event',
    title: '修改事件',
    desc: '改事件的任意字段（标题/时间/正文/标签/评分/花费/呈现形态/所属事件集）。只传要改的',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '事件 id', required: true },
      { name: 'title', type: 'string', desc: '新标题', required: false },
      { name: 'kind', type: 'string', desc: '新类型', required: false },
      { name: 'time', type: 'string', desc: '新开始时间', required: false },
      { name: 'end', type: 'string', desc: '新结束时间；传空串表示清除', required: false },
      { name: 'place', type: 'object', desc: '新地点', required: false },
      { name: 'participants', type: 'array', desc: '新参与者（整体替换）', required: false },
      { name: 'content', type: 'string', desc: '新正文', required: false },
      { name: 'tags', type: 'array', desc: '新标签（整体替换）', required: false },
      { name: 'rating', type: 'number', desc: '新评分', required: false },
      { name: 'cost', type: 'number', desc: '新花费', required: false },
      { name: 'mood', type: 'string', desc: '新心情', required: false },
      { name: 'viewMode', type: 'string', desc: '新呈现形态', required: false, enum: ['doc', 'chat'] },
      { name: 'primaryCollectionId', type: 'string', desc: '新所属事件集', required: false },
    ],
    run: (a) => {
      const cur = getEvent(a.id as string);
      if (!cur) throw new Error(`事件不存在：${a.id}`);
      const patch: Partial<EventInput> = {};
      if (a.title !== undefined) patch.title = a.title as string;
      if (a.kind !== undefined) patch.kind = a.kind as string;
      if (a.time !== undefined || a.end !== undefined) {
        const t = a.time !== undefined ? toTimeSpec(a.time) : { ...cur.time };
        if (a.end !== undefined) t.end = a.end === '' ? null : new Date(Date.parse(String(a.end))).toISOString();
        patch.time = t;
      }
      if (a.place !== undefined) patch.place = a.place as EventInput['place'];
      if (a.participants !== undefined) patch.participants = toParticipants(a.participants);
      if (a.content !== undefined) patch.content = a.content as string;
      if (a.tags !== undefined) patch.tags = a.tags as string[];
      const metrics = { ...cur.metrics };
      let metricsTouched = false;
      if (a.rating !== undefined) { metrics.rating = Number(a.rating); metricsTouched = true; }
      if (a.cost !== undefined) { metrics.cost = Number(a.cost); metricsTouched = true; }
      if (a.mood !== undefined) { metrics.mood = String(a.mood); metricsTouched = true; }
      if (metricsTouched) patch.metrics = metrics;
      if (a.viewMode !== undefined) patch.viewMode = a.viewMode as EventInput['viewMode'];
      if (a.primaryCollectionId !== undefined) patch.primaryCollectionId = a.primaryCollectionId as string | null;
      updateEvent(a.id as string, patch);
      return getEvent(a.id as string);
    },
  },
  {
    name: 'event.delete',
    group: 'event',
    title: '删除事件',
    desc: '软删除：进回收站，可用 event.restore 恢复。优先用这个而不是彻底删除',
    mutating: true,
    params: [{ name: 'id', type: 'string', desc: '事件 id', required: true }],
    run: (a) => {
      const ev = getEvent(a.id as string);
      deleteEvent(a.id as string);
      return { ok: true, id: a.id, event: ev };
    },
  },
  {
    name: 'event.restore',
    group: 'event',
    title: '恢复事件',
    desc: '从回收站恢复一个事件',
    mutating: true,
    params: [{ name: 'id', type: 'string', desc: '事件 id', required: true }],
    run: (a) => {
      restoreEvent(a.id as string);
      return getEvent(a.id as string);
    },
  },
  {
    name: 'event.purge',
    group: 'event',
    title: '彻底删除事件（危险）',
    desc: '物理删除，不可恢复。只该用于清理回收站。普通删除请用 event.delete',
    mutating: true,
    params: [{ name: 'id', type: 'string', desc: '事件 id', required: true }],
    run: (a) => {
      const ev = getEvent(a.id as string);
      purgeEvent(a.id as string);
      return { ok: true, id: a.id, event: ev };
    },
  },
  {
    name: 'event.setPrivate',
    group: 'event',
    title: '标记 / 取消隐私',
    desc: '隐私模式开启后，标了隐私的事件不出现在任何列表里',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '事件 id', required: true },
      { name: 'on', type: 'boolean', desc: 'true=标记隐私, false=取消', required: true },
    ],
    run: (a) => {
      setEventPrivate(a.id as string, a.on === true);
      return getEvent(a.id as string);
    },
  },
  {
    name: 'event.deletedList',
    group: 'event',
    title: '回收站',
    desc: '列出已软删除的事件',
    mutating: false,
    params: [],
    run: () => listDeletedEvents().map(brief),
  },
  {
    name: 'event.stats',
    group: 'event',
    title: '全局统计',
    desc: '事件总数、人物数、总花费、平均评分',
    mutating: false,
    params: [],
    run: () => globalStats(),
  },
];
