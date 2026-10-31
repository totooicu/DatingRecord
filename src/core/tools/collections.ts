// 事件集（含智能集合）相关工具。

import type { ToolDef } from './types';
import {
  getTree,
  getCollection,
  getBreadcrumb,
  listChildren,
  listArchivedCollections,
  listMembers,
  addMember,
  removeMember,
  descendantEventIds,
  createCollection,
  updateCollection,
  moveCollection,
  deleteCollection,
  restoreCollection,
  setCollectionPrivate,
  setCollectionTemplate,
  listSmartEvents,
  describeRule,
  eventTableRows,
} from '../repo/collections';
import { getEvent } from '../repo/events';
import type { Collection, SmartRule } from '../types';

function brief(c: Collection): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    parentId: c.parentId,
    status: c.status,
    description: c.description.slice(0, 120),
    rule: c.rule,
    templateEventId: c.templateEventId,
    isRoot: c.isRoot,
    isPrivate: c.isPrivate,
  };
}

/** 树拍平成带层级的列表，AI 读起来比嵌套结构省 token */
function flatten(node: ReturnType<typeof getTree>, depth = 0, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node) return out;
  out.push({
    depth,
    id: node.id,
    name: node.name,
    kind: node.kind,
    status: node.status,
    eventCount: node.eventCount,
    totalEventCount: node.totalEventCount,
    smart: node.rule ? describeRule(node.rule) : null,
    parentId: node.parentId,
  });
  for (const ch of node.children) flatten(ch, depth + 1, out);
  return out;
}

export const COLLECTION_TOOLS: ToolDef[] = [
  {
    name: 'collection.tree',
    group: 'collection',
    title: '事件集树',
    desc: '整棵事件集树（拍平带层级），含每个集合直接/累计的事件数',
    mutating: false,
    params: [],
    run: () => flatten(getTree()),
  },
  {
    name: 'collection.get',
    group: 'collection',
    title: '事件集详情',
    desc: '单个事件集的完整信息',
    mutating: false,
    params: [{ name: 'id', type: 'string', desc: '事件集 id（c 开头）', required: true }],
    run: (a) => {
      const c = getCollection(a.id as string);
      if (!c) throw new Error(`事件集不存在：${a.id}`);
      return c;
    },
  },
  {
    name: 'collection.breadcrumb',
    group: 'collection',
    title: '事件集路径',
    desc: '从根到该集合的链路（用于给人展示位置）',
    mutating: false,
    params: [{ name: 'id', type: 'string', desc: '事件集 id', required: true }],
    run: (a) => getBreadcrumb(a.id as string).map((c) => ({ id: c.id, name: c.name })),
  },
  {
    name: 'collection.create',
    group: 'collection',
    title: '新建事件集',
    desc: '新建事件集；kind=smart 时按 rule 动态匹配事件，不需要手动加成员',
    mutating: true,
    params: [
      { name: 'name', type: 'string', desc: '名称', required: true },
      { name: 'parentId', type: 'string', desc: '父集合 id，省略则挂到根下', required: false },
      {
        name: 'kind',
        type: 'string',
        desc: '类型',
        required: false,
        default: 'arc',
        enum: ['arc', 'timeline', 'topic', 'project', 'smart'],
      },
      { name: 'description', type: 'string', desc: '描述', required: false },
      {
        name: 'rule',
        type: 'object',
        desc: '智能集合规则：{keyword?,tag?,kind?,personId?,minRating?,withinDays?}',
        required: false,
      },
    ],
    run: (a) => {
      const c = createCollection({
        name: a.name as string,
        parentId: (a.parentId as string | null | undefined) ?? null,
        kind: (a.kind as Collection['kind']) ?? 'arc',
        description: a.description as string | undefined,
        rule: (a.rule as SmartRule | null | undefined) ?? null,
      });
      return brief(c);
    },
  },
  {
    name: 'collection.update',
    group: 'collection',
    title: '修改事件集',
    desc: '改名称/描述/状态/类型/规则。只传要改的字段',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '事件集 id', required: true },
      { name: 'name', type: 'string', desc: '新名称', required: false },
      { name: 'description', type: 'string', desc: '新描述', required: false },
      {
        name: 'status',
        type: 'string',
        desc: 'ongoing=进行中, finished=已完结, archived=归档',
        required: false,
        enum: ['ongoing', 'finished', 'archived'],
      },
      { name: 'kind', type: 'string', desc: '新类型（改成 smart 会清空手动成员）', required: false },
      { name: 'rule', type: 'object', desc: '新的智能规则（普通集合忽略）', required: false },
    ],
    run: (a) => {
      const patch: Partial<Pick<Collection, 'name' | 'description' | 'status' | 'kind' | 'rule'>> = {};
      if (a.name !== undefined) patch.name = a.name as string;
      if (a.description !== undefined) patch.description = a.description as string;
      if (a.status !== undefined) patch.status = a.status as Collection['status'];
      if (a.kind !== undefined) patch.kind = a.kind as Collection['kind'];
      if (a.rule !== undefined) patch.rule = a.rule as SmartRule | null;
      updateCollection(a.id as string, patch);
      return brief(getCollection(a.id as string)!);
    },
  },
  {
    name: 'collection.move',
    group: 'collection',
    title: '移动事件集',
    desc: '把集合挂到另一个父集合下（parentId 为空表示移到根）',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '事件集 id', required: true },
      { name: 'parentId', type: 'string', desc: '新父集合 id，空串表示根', required: true },
    ],
    run: (a) => {
      const r = moveCollection(a.id as string, (a.parentId as string) || null);
      if (!r.ok) throw new Error(r.reason ?? '移动失败');
      return { ok: true };
    },
  },
  {
    name: 'collection.delete',
    group: 'collection',
    title: '删除事件集',
    desc: '软删除（归档）：集合与成员都还在，可恢复。事件本身不受影响',
    mutating: true,
    params: [{ name: 'id', type: 'string', desc: '事件集 id', required: true }],
    run: (a) => {
      const c = getCollection(a.id as string);
      const r = deleteCollection(a.id as string);
      if (!r.ok) throw new Error(r.reason ?? '删除失败');
      return { ok: true, id: a.id, name: c?.name ?? '' };
    },
  },
  {
    name: 'collection.restore',
    group: 'collection',
    title: '恢复事件集',
    desc: '恢复被软删除/归档的事件集',
    mutating: true,
    params: [{ name: 'id', type: 'string', desc: '事件集 id', required: true }],
    run: (a) => {
      restoreCollection(a.id as string);
      return { ok: true };
    },
  },
  {
    name: 'collection.archivedList',
    group: 'collection',
    title: '归档的事件集',
    desc: '列出已归档的事件集',
    mutating: false,
    params: [],
    run: () => listArchivedCollections().map(brief),
  },
  {
    name: 'collection.setPrivate',
    group: 'collection',
    title: '标记 / 取消隐私',
    desc: '隐私模式开启后整棵集合隐藏',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '事件集 id', required: true },
      { name: 'on', type: 'boolean', desc: 'true=标记隐私, false=取消', required: true },
    ],
    run: (a) => {
      setCollectionPrivate(a.id as string, a.on === true);
      return { ok: true };
    },
  },
  {
    name: 'collection.members',
    group: 'collection',
    title: '事件集成员',
    desc: '直接挂在集合下的成员（事件或子集合）',
    mutating: false,
    params: [{ name: 'id', type: 'string', desc: '事件集 id', required: true }],
    run: (a) =>
      listMembers(a.id as string).map((m) => ({
        memberType: m.memberType,
        memberId: m.memberId,
        name: m.memberType === 'event' ? getEvent(m.memberId)?.title : getCollection(m.memberId)?.name,
      })),
  },
  {
    name: 'collection.addMember',
    group: 'collection',
    title: '加入成员',
    desc: '把一个事件或子集合挂到事件集下',
    mutating: true,
    params: [
      { name: 'collectionId', type: 'string', desc: '事件集 id', required: true },
      { name: 'memberType', type: 'string', desc: 'event=事件, collection=子集合', required: true, enum: ['event', 'collection'] },
      { name: 'memberId', type: 'string', desc: '被挂入的事件/集合 id', required: true },
    ],
    run: (a) => {
      addMember(a.collectionId as string, a.memberType as 'event' | 'collection', a.memberId as string);
      return { ok: true };
    },
  },
  {
    name: 'collection.removeMember',
    group: 'collection',
    title: '移出成员',
    desc: '把事件/子集合从事件集摘下（不删除对象本身）',
    mutating: true,
    params: [
      { name: 'collectionId', type: 'string', desc: '事件集 id', required: true },
      { name: 'memberType', type: 'string', desc: 'event=事件, collection=子集合', required: true, enum: ['event', 'collection'] },
      { name: 'memberId', type: 'string', desc: '成员 id', required: true },
    ],
    run: (a) => {
      removeMember(a.collectionId as string, a.memberType as 'event' | 'collection', a.memberId as string);
      return { ok: true };
    },
  },
  {
    name: 'collection.events',
    group: 'collection',
    title: '事件集下的事件',
    desc: '该集合及其所有子集合下的事件（智能集合按规则现算）',
    mutating: false,
    params: [
      { name: 'id', type: 'string', desc: '事件集 id', required: true },
      { name: 'limit', type: 'number', desc: '最多返回几条，默认 100', required: false, default: 100 },
    ],
    run: (a) => {
      const c = getCollection(a.id as string);
      if (!c) throw new Error(`事件集不存在：${a.id}`);
      const ids = c.rule ? listSmartEvents(c).map((e) => e.id) : descendantEventIds(c.id);
      const limit = a.limit === undefined ? 100 : Number(a.limit);
      return {
        count: ids.length,
        events: ids.slice(0, limit).map((id) => {
          const e = getEvent(id);
          return e ? { id: e.id, title: e.title, kind: e.kind, startTs: e.startTs } : { id, missing: true };
        }),
      };
    },
  },
  {
    name: 'collection.setTemplate',
    group: 'collection',
    title: '设置模板事件',
    desc: '为事件集指定模板事件：在本集合下新建事件时自动带入它的类型/人物/地点/标签/正文/度量；eventId 传空串清除模板',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '事件集 id', required: true },
      { name: 'eventId', type: 'string', desc: '模板事件 id；空串表示不使用模板', required: true },
    ],
    run: (a) => {
      const id = a.id as string;
      const eventId = (a.eventId as string) || null;
      setCollectionTemplate(id, eventId);
      return { ok: true, id, templateEventId: eventId };
    },
  },
  {
    name: 'collection.table',
    group: 'collection',
    title: '事件集表格',
    desc: '按事件集「表格阅览」的列返回数据：标题/时间/类型/人物/地点/标签/评分/花费。普通集合取直接成员，智能集合取规则命中事件',
    mutating: false,
    params: [
      { name: 'id', type: 'string', desc: '事件集 id', required: true },
      { name: 'limit', type: 'number', desc: '最多返回几行，默认 200', required: false, default: 200 },
    ],
    run: (a) => {
      const c = getCollection(a.id as string);
      if (!c) throw new Error(`事件集不存在：${a.id}`);
      const events = c.rule
        ? listSmartEvents(c)
        : listMembers(c.id).flatMap((m) => {
            if (m.memberType !== 'event') return [];
            const e = getEvent(m.memberId);
            return e ? [e] : [];
          });
      const limit = a.limit === undefined ? 200 : Number(a.limit);
      const rows = eventTableRows(events);
      return { count: rows.length, rows: rows.slice(0, limit) };
    },
  },
  {
    name: 'collection.children',
    group: 'collection',
    title: '子集合列表',
    desc: '直接子集合',
    mutating: false,
    params: [{ name: 'id', type: 'string', desc: '父集合 id', required: true }],
    run: (a) => listChildren(a.id as string).map(brief),
  },
];
