// 分享向导的纯数据层：步骤名、草稿结构、树摊平、两种「事件集详情」的取数。
// 不碰 React 状态，四个步骤组件都能直接引。

import { formatAttrValue } from '../../attr';
import { eventsOfCollections } from '../../../core/io';
import {
  getBreadcrumb,
  getCollection,
  listChildren,
  listSmartEvents,
  type TreeNode,
} from '../../../core/repo/collections';
import { listDefs } from '../../../core/repo/persons';
import type { Collection, Person, ShareFile, ShareLevel } from '../../../core/types';
import { ruleTextOf, type ColPeekData } from '../SharePeeks';

export const STEPS = ['事件集', '人物', '程度', '预览'];

/** 草稿只存「选到哪儿了」，不存预览结果与派生的 id 集合 */
export const DRAFT_KEY = 'share-wizard';

export interface WizardDraft {
  step: number;
  colIds: string[];
  excluded: string[];
  expanded: string[];
  extraPicked: string[];
  level: ShareLevel;
  attrKeys: string[];
  withAttachments: boolean;
}

export interface ColRow {
  id: string;
  name: string;
  depth: number;
  smart: boolean;
  /** 含子集在内的事件数 */
  eventCount: number;
  /** 从根到父的 id，用来判断这一行是不是「选择根」 */
  ancestors: string[];
}

/** 把树摊平，根集合本身不列出来——分享「全部」没有意义，也从顶层事件集开始选 */
export function rowsOf(tree: TreeNode | null): ColRow[] {
  const out: ColRow[] = [];
  const walk = (n: TreeNode, depth: number, ancestors: string[]) => {
    out.push({
      id: n.id,
      name: n.name,
      depth,
      smart: n.kind === 'smart',
      eventCount: n.totalEventCount,
      ancestors,
    });
    for (const c of n.children) walk(c, depth + 1, [...ancestors, n.id]);
  };
  for (const c of tree?.children ?? []) walk(c, 0, []);
  return out;
}

/** 属性值的展示：按字典顺序，找不到定义就退回 key */
export function attrsOf(p: Person, defs: ReturnType<typeof listDefs>) {
  return Object.entries(p.attrs).map(([key, av]) => {
    const def = defs.find((d) => d.key === key);
    return {
      key,
      label: def?.label ?? key,
      text: def ? formatAttrValue(def, av.v) : String(av.v ?? ''),
    };
  });
}

export const STATUS_TEXT: Record<Collection['status'], string> = {
  ongoing: '进行中',
  finished: '已完成',
  archived: '已归档',
};

/** 本库的事件集详情：事件按当前勾选状态标出「不分享」 */
export function repoColPeek(id: string, excluded: Set<string>): ColPeekData | null {
  const c = getCollection(id);
  if (!c) return null;
  return {
    name: c.name,
    smart: c.kind === 'smart',
    path: getBreadcrumb(id)
      .filter((x) => !x.isRoot && x.id !== id)
      .map((x) => x.name)
      .join(' / '),
    description: c.description,
    ruleText: ruleTextOf(c),
    statusLabel: STATUS_TEXT[c.status] ?? c.status,
    isPrivate: c.isPrivate,
    children: listChildren(id).map((x) => x.name),
    events: eventsOfCollections([id]).map((e) => ({ event: e, off: excluded.has(e.id) })),
  };
}

/** 预览里的事件集详情：只能看打包带走的那些事件与子集 */
export function shareColPeek(c: Collection, share: ShareFile): ColPeekData {
  const byId = new Map(share.collections.map((x) => [x.id, x]));
  const path: string[] = [];
  let p = c.parentId ? byId.get(c.parentId) : null;
  while (p) {
    if (!p.isRoot) path.unshift(p.name);
    p = p.parentId ? byId.get(p.parentId) : null;
  }

  // 子集 + 直接挂在本集合上的事件；智能集合没有成员行，事件得按规则现算再和包内事件取交集
  const ids = new Set([c.id]);
  const stack = [c.id];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const x of share.collections) {
      if (x.parentId === cur && !ids.has(x.id)) {
        ids.add(x.id);
        stack.push(x.id);
      }
    }
  }
  const eventIds = new Set(
    share.members
      .filter((m) => m.memberType === 'event' && ids.has(m.collectionId))
      .map((m) => m.memberId),
  );
  for (const x of share.collections) {
    if (!ids.has(x.id) || x.kind !== 'smart') continue;
    for (const e of listSmartEvents(x)) eventIds.add(e.id);
  }

  return {
    name: c.name,
    smart: c.kind === 'smart',
    path: path.join(' / '),
    description: c.description,
    ruleText: ruleTextOf(c),
    statusLabel: STATUS_TEXT[c.status] ?? c.status,
    isPrivate: c.isPrivate,
    children: share.collections.filter((x) => x.parentId === c.id).map((x) => x.name),
    events: share.events.filter((e) => eventIds.has(e.id)).map((e) => ({ event: e })),
  };
}

/** 预览里每个人出现在几个事件中（额外多选的人会是 0） */
export function countsOf(preview: ShareFile | null): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of preview?.events ?? []) {
    for (const p of e.participants) map.set(p.personId, (map.get(p.personId) ?? 0) + 1);
  }
  return map;
}

