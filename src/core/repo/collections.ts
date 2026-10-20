// 事件集仓储：树形嵌套（闭包表）+ 成员管理（fractional index 排序）

import { queryAll, queryOne, run, transact, appendOplog, getDeviceId } from '../db';
import { newId } from '../id';
import { hlcNow } from '../time';
import { orderKeyBetween, FIRST_ORDER_KEY } from '../order';
import type { Collection, CollectionKind } from '../types';

interface CollectionRow {
  id: string;
  name: string;
  kind: string;
  parent_id: string | null;
  order_key: string;
  description: string;
  cover: string | null;
  status: string;
  rule_json: string | null;
  is_root: number;
  time_range_auto: number;
  time_range_start: string | null;
  time_range_end: string | null;
  device_id: string;
  rev: number;
  hlc: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

function collectionFromRow(r: CollectionRow): Collection {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as CollectionKind,
    parentId: r.parent_id,
    orderKey: r.order_key,
    description: r.description,
    cover: r.cover,
    status: r.status as Collection['status'],
    rule: r.rule_json ? JSON.parse(r.rule_json) : null,
    isRoot: !!r.is_root,
    timeRangeAuto: !!r.time_range_auto,
    timeRangeStart: r.time_range_start,
    timeRangeEnd: r.time_range_end,
    deviceId: r.device_id,
    rev: r.rev,
    hlc: r.hlc,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------------- 闭包表 ----------------

/**
 * 全量重建闭包表。数据量小（个人档案），全量重建比增量维护更不容易出错。
 * 闭包表的作用：一次 JOIN 就能查出「某集合下所有嵌套层级的内容」。
 */
function rebuildClosure(): void {
  run('DELETE FROM collection_closure');
  const rows = queryAll<{ id: string; parent_id: string | null }>(
    'SELECT id, parent_id FROM collections WHERE deleted_at IS NULL',
  );
  const ids = new Set(rows.map((r) => r.id));
  const children = new Map<string, string[]>();
  for (const r of rows) {
    const pk = r.parent_id && ids.has(r.parent_id) ? r.parent_id : '__root__';
    if (!children.has(pk)) children.set(pk, []);
    children.get(pk)!.push(r.id);
  }

  const stack: { id: string; ancestors: string[] }[] = (children.get('__root__') ?? []).map((id) => ({
    id,
    ancestors: [] as string[],
  }));

  while (stack.length) {
    const { id, ancestors } = stack.pop()!;
    run('INSERT OR REPLACE INTO collection_closure (ancestor_id, descendant_id, depth) VALUES (?,?,0)', [id, id]);
    for (let i = 0; i < ancestors.length; i++) {
      run('INSERT OR REPLACE INTO collection_closure (ancestor_id, descendant_id, depth) VALUES (?,?,?)', [
        ancestors[i],
        id,
        i + 1,
      ]);
    }
    for (const kid of children.get(id) ?? []) {
      stack.push({ id: kid, ancestors: [id, ...ancestors] });
    }
  }
}

// ---------------- 查询 ----------------

export function getRoot(): Collection | null {
  const row = queryOne<CollectionRow>('SELECT * FROM collections WHERE is_root = 1 LIMIT 1');
  return row ? collectionFromRow(row) : null;
}

export function getCollection(id: string): Collection | null {
  const row = queryOne<CollectionRow>('SELECT * FROM collections WHERE id = ? AND deleted_at IS NULL', [id]);
  return row ? collectionFromRow(row) : null;
}

export interface TreeNode extends Collection {
  children: TreeNode[];
  eventCount: number;
  /** 含所有子孙集合在内的事件数（闭包表聚合，根集合即为全库事件数） */
  totalEventCount: number;
}

/** 构建完整树（eventCount = 直接成员事件数；totalEventCount = 含子孙的事件数） */
export function getTree(): TreeNode | null {
  const root = getRoot();
  if (!root) return null;
  const rows = queryAll<CollectionRow>(
    'SELECT * FROM collections WHERE deleted_at IS NULL ORDER BY order_key',
  );
  const all = rows.map(collectionFromRow);
  const counts = new Map<string, number>();
  for (const row of queryAll<{ collection_id: string; c: number }>(
    "SELECT collection_id, COUNT(*) AS c FROM collection_members WHERE member_type = 'event' AND deleted_at IS NULL GROUP BY collection_id",
  )) {
    counts.set(row.collection_id, row.c);
  }

  // 按闭包表聚合：一次查询算出每个集合（含所有嵌套层级）下的事件数
  const totals = new Map<string, number>();
  for (const row of queryAll<{ ancestor_id: string; c: number }>(
    `SELECT cl.ancestor_id AS ancestor_id, COUNT(DISTINCT m.member_id) AS c
     FROM collection_closure cl
     JOIN collection_members m ON m.collection_id = cl.descendant_id
     JOIN events e ON e.id = m.member_id
     WHERE m.member_type = 'event' AND m.deleted_at IS NULL AND e.deleted_at IS NULL
     GROUP BY cl.ancestor_id`,
  )) {
    totals.set(row.ancestor_id, row.c);
  }

  const build = (c: Collection): TreeNode => ({
    ...c,
    children: all.filter((x) => x.parentId === c.id).map(build),
    eventCount: counts.get(c.id) ?? 0,
    totalEventCount: totals.get(c.id) ?? 0,
  });
  return build(root);
}

export function getBreadcrumb(id: string): Collection[] {
  const rows = queryAll<{ ancestor_id: string }>(
    'SELECT ancestor_id FROM collection_closure WHERE descendant_id = ? ORDER BY depth DESC',
    [id],
  );
  return rows.map((r) => getCollection(r.ancestor_id)).filter((c): c is Collection => !!c);
}

export function listChildren(parentId: string): Collection[] {
  return queryAll<CollectionRow>(
    'SELECT * FROM collections WHERE parent_id = ? AND deleted_at IS NULL ORDER BY order_key',
    [parentId],
  ).map(collectionFromRow);
}

// ---------------- 写操作 ----------------

export function createCollection(input: {
  name: string;
  parentId?: string | null;
  kind?: CollectionKind;
  description?: string;
}): Collection {
  const id = newId('c');
  const now = new Date().toISOString();
  const parentId = input.parentId ?? getRoot()?.id ?? null;
  const siblings = parentId ? listChildren(parentId) : [];
  const lastKey = siblings.length ? siblings[siblings.length - 1].orderKey : null;

  transact(() => {
    run(
      `INSERT INTO collections
       (id,name,kind,parent_id,order_key,description,status,is_root,time_range_auto,device_id,rev,hlc,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.name,
        input.kind ?? 'arc',
        parentId,
        orderKeyBetween(lastKey, null),
        input.description ?? '',
        'ongoing',
        0,
        1,
        getDeviceId(),
        1,
        hlcNow(getDeviceId()),
        now,
        now,
      ],
    );
    appendOplog('collection', id, 'insert', { name: input.name, parentId });
  });
  rebuildClosure();
  return getCollection(id)!;
}

export function updateCollection(
  id: string,
  patch: Partial<Pick<Collection, 'name' | 'description' | 'status' | 'kind' | 'cover'>>,
): void {
  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());
  transact(() => {
    const c = getCollection(id);
    if (!c) return;
    run(
      `UPDATE collections SET name=?, description=?, status=?, kind=?, cover=?, rev=rev+1, hlc=?, updated_at=? WHERE id=?`,
      [
        patch.name ?? c.name,
        patch.description ?? c.description,
        patch.status ?? c.status,
        patch.kind ?? c.kind,
        patch.cover ?? c.cover ?? null,
        hlc,
        now,
        id,
      ],
    );
    appendOplog('collection', id, 'update', patch);
  });
}

/**
 * 移动集合：必须做环检测（不能把集合移进自己的子孙），移动后重建闭包表。
 */
export function moveCollection(id: string, newParentId: string | null): { ok: boolean; reason?: string } {
  if (id === newParentId) return { ok: false, reason: '不能移动到自己下面' };
  if (newParentId) {
    const desc = queryAll<{ descendant_id: string }>(
      'SELECT descendant_id FROM collection_closure WHERE ancestor_id = ?',
      [id],
    ).map((r) => r.descendant_id);
    if (desc.includes(newParentId)) {
      return { ok: false, reason: '不能移动到自己的子集合下面（会形成环）' };
    }
  }
  const c = getCollection(id);
  if (!c) return { ok: false, reason: '集合不存在' };
  if (c.isRoot) return { ok: false, reason: '根集合不可移动' };

  const siblings = newParentId ? listChildren(newParentId) : [];
  const lastKey = siblings.length ? siblings[siblings.length - 1].orderKey : null;
  transact(() => {
    run('UPDATE collections SET parent_id = ?, order_key = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
      newParentId,
      orderKeyBetween(lastKey, null),
      hlcNow(getDeviceId()),
      new Date().toISOString(),
      id,
    ]);
    appendOplog('collection', id, 'update', { parentId: newParentId });
  });
  rebuildClosure();
  return { ok: true };
}

/** 软删除：只解绑成员关联，绝不级联删除事件 */
export function deleteCollection(id: string): { ok: boolean; reason?: string } {
  const c = getCollection(id);
  if (!c) return { ok: false, reason: '集合不存在' };
  if (c.isRoot) return { ok: false, reason: '根集合不可删除' };
  transact(() => {
    run('UPDATE collections SET deleted_at = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
      new Date().toISOString(),
      hlcNow(getDeviceId()),
      new Date().toISOString(),
      id,
    ]);
    run('UPDATE collection_members SET deleted_at = ? WHERE collection_id = ?', [new Date().toISOString(), id]);
    appendOplog('collection', id, 'delete', { id });
  });
  rebuildClosure();
  return { ok: true };
}

// ---------------- 成员 ----------------

export interface MemberItem {
  memberType: 'event' | 'collection';
  memberId: string;
  orderKey: string;
  note: string;
}

export function listMembers(collectionId: string): MemberItem[] {
  return queryAll<{ member_type: string; member_id: string; order_key: string; note: string }>(
    'SELECT member_type, member_id, order_key, note FROM collection_members WHERE collection_id = ? AND deleted_at IS NULL ORDER BY order_key',
    [collectionId],
  ).map((r) => ({
    memberType: r.member_type as MemberItem['memberType'],
    memberId: r.member_id,
    orderKey: r.order_key,
    note: r.note,
  }));
}

export function addMember(collectionId: string, memberType: 'event' | 'collection', memberId: string): void {
  const members = listMembers(collectionId);
  if (members.some((m) => m.memberType === memberType && m.memberId === memberId)) return;
  const lastKey = members.length ? members[members.length - 1].orderKey : null;
  transact(() => {
    run(
      `INSERT OR REPLACE INTO collection_members (collection_id, member_type, member_id, order_key, note, device_id, hlc)
       VALUES (?,?,?,?,?,?,?)`,
      [collectionId, memberType, memberId, orderKeyBetween(lastKey, null), '', getDeviceId(), hlcNow(getDeviceId())],
    );
    appendOplog('collection_member', `${collectionId}:${memberId}`, 'insert', { collectionId, memberType, memberId });
  });
}

/** 移除成员：只删关联，绝不删事件本身 */
export function removeMember(collectionId: string, memberType: 'event' | 'collection', memberId: string): void {
  transact(() => {
    run('UPDATE collection_members SET deleted_at = ? WHERE collection_id = ? AND member_type = ? AND member_id = ?', [
      new Date().toISOString(),
      collectionId,
      memberType,
      memberId,
    ]);
    appendOplog('collection_member', `${collectionId}:${memberId}`, 'delete', { collectionId, memberType, memberId });
  });
}

/** 把成员移动到指定下标（用 fractional index 生成新键，只改这一行） */
export function moveMemberTo(
  collectionId: string,
  memberType: 'event' | 'collection',
  memberId: string,
  targetIndex: number,
): void {
  const members = listMembers(collectionId);
  const idx = members.findIndex((m) => m.memberType === memberType && m.memberId === memberId);
  if (idx < 0) return;
  const rest = members.filter((_, i) => i !== idx);
  const clamped = Math.max(0, Math.min(targetIndex, rest.length));
  const before = clamped > 0 ? rest[clamped - 1].orderKey : null;
  const after = clamped < rest.length ? rest[clamped].orderKey : null;
  const newKey = orderKeyBetween(before, after);
  transact(() => {
    run(
      'UPDATE collection_members SET order_key = ? WHERE collection_id = ? AND member_type = ? AND member_id = ?',
      [newKey, collectionId, memberType, memberId],
    );
    appendOplog('collection_member', `${collectionId}:${memberId}`, 'update', { orderKey: newKey });
  });
}

/** 某事件所属的所有集合（用于详情页展示与「加入集合」） */
export function collectionsOfEvent(eventId: string): Collection[] {
  return queryAll<{ collection_id: string }>(
    "SELECT collection_id FROM collection_members WHERE member_type = 'event' AND member_id = ? AND deleted_at IS NULL",
    [eventId],
  )
    .map((r) => getCollection(r.collection_id))
    .filter((c): c is Collection => !!c);
}

/** 集合（含所有嵌套层级）下的事件 ID */
export function descendantEventIds(collectionId: string): string[] {
  return queryAll<{ member_id: string }>(
    `SELECT DISTINCT m.member_id FROM collection_members m
     JOIN collection_closure cl ON cl.descendant_id = m.collection_id
     WHERE cl.ancestor_id = ? AND m.member_type = 'event' AND m.deleted_at IS NULL`,
    [collectionId],
  ).map((r) => r.member_id);
}

export function ensureClosure(): void {
  rebuildClosure();
}

export { FIRST_ORDER_KEY };
