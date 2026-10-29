// 人物相关工具。每个 run 都是对 repo/persons 下已实现函数的一层薄包装——
// 不在这里重写任何业务逻辑，只做「参数收拢 + 结果裁剪」。

import type { ToolDef } from './types';
import { existingInputChoices } from '../repo/inputChoices';
import {
  listPersons,
  listArchivedPersons,
  unarchivePerson,
  getPerson,
  findDuplicatePersons,
  mergePersons,
  listDefs,
  upsertDef,
  listAttrHistory,
  listTemplates,
  applyTemplate,
} from '../repo/persons';
import { createPerson, updatePerson, deletePerson, hardDeletePerson, setPersonPrivate } from '../repo/persons/write';
import { setAttribute } from '../repo/persons/values';
import type { AttributeType, Person } from '../types';

/** 列表场合只回摘要：attrs 可能很大，全塞给模型既费 token 又淹没有效信息 */
function brief(p: Person & { stats?: unknown }): Record<string, unknown> {
  return {
    id: p.id,
    displayName: p.displayName,
    aliases: p.aliases,
    kind: p.kind,
    status: p.status,
    tags: p.tags,
    attrKeys: Object.keys(p.attrs ?? {}),
    notes: p.notes ? p.notes.slice(0, 200) : '',
    isPrivate: p.isPrivate,
  };
}

export const PERSON_TOOLS: ToolDef[] = [
  {
    name: 'person.inputChoices', group: 'person', title: '已有内容候选',
    desc: '从现有公开记录收集属性、标签或心情候选，按使用次数排序，不含私密记录和敏感属性',
    mutating: false,
    params: [
      { name: 'source', type: 'string', required: true, enum: ['tags', 'mood', 'attribute'], desc: '候选来源' },
      { name: 'key', type: 'string', required: false, desc: 'attribute 来源的属性键' },
    ],
    run: (a) => existingInputChoices(a.source as 'tags' | 'mood' | 'attribute', a.key as string | undefined).slice(0, 20),
  },
  {
    name: 'person.list',
    group: 'person',
    title: '列出人物',
    desc: '按关键词搜索人物，返回摘要（id/姓名/别名/标签/属性键）。要完整属性用 person.get',
    mutating: false,
    params: [
      { name: 'keyword', type: 'string', desc: '姓名/别名/标签模糊搜索，可省略', required: false },
      { name: 'includeArchived', type: 'boolean', desc: '包含已归档人物', required: false, default: false },
    ],
    run: (a) =>
      listPersons({
        keyword: a.keyword as string | undefined,
        includeArchived: a.includeArchived as boolean | undefined,
      }).map(brief),
  },
  {
    name: 'person.archivedList',
    group: 'person',
    title: '归档 / 已合并的人物',
    desc: '列出不在人物列表里的记录（手动归档的、合并后留下的墓碑）及其原因',
    mutating: false,
    params: [],
    run: () =>
      listArchivedPersons().map((p) => ({ ...brief(p), reason: p.reason, mergedIntoName: p.mergedIntoName })),
  },
  {
    name: 'person.get',
    group: 'person',
    title: '人物详情',
    desc: '按 id 取单个人物：完整属性、备注、标签、统计',
    mutating: false,
    params: [{ name: 'id', type: 'string', desc: '人物 id（p 开头）', required: true }],
    run: (a) => {
      const p = getPerson(a.id as string);
      if (!p) throw new Error(`人物不存在：${a.id}`);
      return p;
    },
  },
  {
    name: 'person.create',
    group: 'person',
    title: '新建人物',
    desc: '创建人物。attrs 的键必须是已存在的属性定义（见 person.attrDefs），否则会被忽略',
    mutating: true,
    params: [
      { name: 'displayName', type: 'string', desc: '姓名 / 称呼', required: true },
      { name: 'tags', type: 'array', desc: '标签数组', required: false },
      { name: 'attrs', type: 'object', desc: '属性值，如 {"phone":"138...","birthday":"1998-05-01"}', required: false },
    ],
    run: (a) =>
      createPerson({
        displayName: a.displayName as string,
        tags: (a.tags as string[] | undefined) ?? undefined,
        attrs: (a.attrs as Record<string, never> | undefined) ?? undefined,
      }),
  },
  {
    name: 'person.update',
    group: 'person',
    title: '修改人物',
    desc: '改姓名/别名/标签/备注/类型/头像。只传要改的字段',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '人物 id', required: true },
      { name: 'displayName', type: 'string', desc: '新姓名', required: false },
      { name: 'aliases', type: 'array', desc: '别名数组（整体替换）', required: false },
      { name: 'tags', type: 'array', desc: '标签数组（整体替换）', required: false },
      { name: 'notes', type: 'string', desc: '备注全文（整体替换）', required: false },
      { name: 'kind', type: 'string', desc: 'person=个人, group=群体', required: false, enum: ['person', 'group'] },
      { name: 'status', type: 'string', desc: 'active=正常, archived=归档', required: false, enum: ['active', 'archived'] },
    ],
    run: (a) => {
      const patch: Partial<Pick<Person, 'displayName' | 'aliases' | 'tags' | 'notes' | 'status' | 'kind'>> = {};
      if (a.displayName !== undefined) patch.displayName = a.displayName as string;
      if (a.aliases !== undefined) patch.aliases = a.aliases as string[];
      if (a.tags !== undefined) patch.tags = a.tags as string[];
      if (a.notes !== undefined) patch.notes = a.notes as string;
      if (a.kind !== undefined) patch.kind = a.kind as Person['kind'];
      if (a.status !== undefined) patch.status = a.status as Person['status'];
      updatePerson(a.id as string, patch);
      return getPerson(a.id as string);
    },
  },
  {
    name: 'person.setAttr',
    group: 'person',
    title: '设置人物属性',
    desc: '写单个属性值。值为 null/空串/空数组表示清除该属性。timeVarying 属性会自动留历史',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '人物 id', required: true },
      { name: 'key', type: 'string', desc: '属性键，如 phone/birthday/height', required: true },
      { name: 'value', type: 'string', desc: '属性值（数字/布尔也传字符串即可）', required: true },
      { name: 'note', type: 'string', desc: '备注这条值是哪来的', required: false },
    ],
    run: (a) => {
      setAttribute(a.id as string, a.key as string, a.value, { note: a.note as string | undefined });
      return getPerson(a.id as string);
    },
  },
  {
    name: 'person.attrHistory',
    group: 'person',
    title: '属性历史',
    desc: '看某个（或全部）随时间变化的属性的历史曲线数据',
    mutating: false,
    params: [
      { name: 'id', type: 'string', desc: '人物 id', required: true },
      { name: 'key', type: 'string', desc: '属性键，省略则返回全部', required: false },
    ],
    run: (a) => listAttrHistory(a.id as string, a.key as string | undefined),
  },
  {
    name: 'person.archive',
    group: 'person',
    title: '归档人物',
    desc: '软删除：人物从列表消失但数据完好，可用 person.restore 恢复。优先用这个而不是硬删',
    mutating: true,
    params: [{ name: 'id', type: 'string', desc: '人物 id', required: true }],
    run: (a) => {
      const p = getPerson(a.id as string);
      deletePerson(a.id as string);
      return { ok: true, id: a.id, displayName: p?.displayName ?? '' };
    },
  },
  {
    name: 'person.restore',
    group: 'person',
    title: '恢复归档人物',
    desc: '把 archived 状态的人物恢复为 active',
    mutating: true,
    params: [{ name: 'id', type: 'string', desc: '人物 id', required: true }],
    run: (a) => {
      unarchivePerson(a.id as string);
      return getPerson(a.id as string);
    },
  },
  {
    name: 'person.hardDelete',
    group: 'person',
    title: '彻底删除人物（危险）',
    desc: '物理删除，不可恢复，只该用于清理合并留下的空墓碑。普通删除请用 person.archive',
    mutating: true,
    params: [{ name: 'id', type: 'string', desc: '人物 id', required: true }],
    run: (a) => {
      const p = getPerson(a.id as string);
      hardDeletePerson(a.id as string);
      return { ok: true, id: a.id, displayName: p?.displayName ?? '' };
    },
  },
  {
    name: 'person.setPrivate',
    group: 'person',
    title: '标记 / 取消隐私',
    desc: '隐私模式开启后，标了隐私的人物不出现在任何列表里',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '人物 id', required: true },
      { name: 'on', type: 'boolean', desc: 'true=标记隐私, false=取消', required: true },
    ],
    run: (a) => {
      setPersonPrivate(a.id as string, a.on === true);
      return getPerson(a.id as string);
    },
  },
  {
    name: 'person.attrDefs',
    group: 'person',
    title: '属性定义列表',
    desc: '所有可用的属性定义（键、标签、类型、单位、是否随时间变化）',
    mutating: false,
    params: [{ name: 'includeArchived', type: 'boolean', desc: '包含已归档定义', required: false, default: false }],
    run: (a) => listDefs(a.includeArchived === true),
  },
  {
    name: 'person.attrDefUpsert',
    group: 'person',
    title: '新建 / 修改属性定义',
    desc: 'key 已存在则改标签/类型/单位，不存在则新建',
    mutating: true,
    params: [
      { name: 'key', type: 'string', desc: '属性键（英文小写）', required: true },
      { name: 'label', type: 'string', desc: '显示名', required: true },
      {
        name: 'type',
        type: 'string',
        desc: '值类型',
        required: true,
        enum: [
          'text', 'longtext', 'number', 'money', 'date', 'datetime', 'enum', 'enumMulti',
          'boolean', 'rating', 'tag', 'phone', 'email', 'url', 'social', 'address',
          'geo', 'color', 'media', 'relation', 'json', 'computed',
        ],
      },
      { name: 'unit', type: 'string', desc: '单位，如 cm/kg/岁', required: false },
      { name: 'timeVarying', type: 'boolean', desc: '是否随时间变化（会记历史曲线）', required: false },
      { name: 'options', type: 'array', desc: 'select/multiselect 的候选项', required: false },
    ],
    run: (a) => {
      upsertDef({
        key: a.key as string,
        label: a.label as string,
        type: a.type as AttributeType,
        unit: a.unit as string | undefined,
        timeVarying: a.timeVarying === true,
        options: a.options as string[] | undefined,
      });
      return { ok: true };
    },
  },
  {
    name: 'person.findDuplicates',
    group: 'person',
    title: '查找可能重复的人物',
    desc: '按同名/同别名/同属性找出疑似重复的人物分组',
    mutating: false,
    params: [],
    run: () => findDuplicatePersons().map((g) => g.map(brief)),
  },
  {
    name: 'person.merge',
    group: 'person',
    title: '合并两个人物（危险）',
    desc: '把 dropId 并进 keepId：事件关联、属性值按 choices 取舍。先用 previewMerge 的思路核对（person.findDuplicates + 逐个对比）',
    mutating: true,
    params: [
      { name: 'keepId', type: 'string', desc: '保留的人物 id', required: true },
      { name: 'dropId', type: 'string', desc: '被合并掉的人物 id', required: true },
      {
        name: 'choices',
        type: 'object',
        desc: '每个字段取哪边：{"displayName":"keep","phone":"drop",...}，没给的字段默认保留 keepId 的值',
        required: false,
      },
    ],
    run: (a) => {
      mergePersons(
        a.keepId as string,
        a.dropId as string,
        (a.choices as Record<string, 'keep' | 'drop'> | undefined) ?? {},
      );
      return getPerson(a.keepId as string);
    },
  },
  {
    name: 'person.templates',
    group: 'person',
    title: '属性模板列表',
    desc: '列出属性模板（一组属性键，可一次性套用到某个人物）',
    mutating: false,
    params: [],
    run: () => listTemplates(),
  },
  {
    name: 'person.applyTemplate',
    group: 'person',
    title: '套用属性模板',
    desc: '把模板里的属性键写到人物上（值留空，等待后续填写）',
    mutating: true,
    params: [
      { name: 'templateId', type: 'string', desc: '模板 id', required: true },
      { name: 'personId', type: 'string', desc: '人物 id', required: true },
    ],
    run: (a) => {
      const n = applyTemplate(a.templateId as string, a.personId as string);
      return { applied: n };
    },
  },
];
