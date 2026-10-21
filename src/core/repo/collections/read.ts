// 事件集读取：树、面包屑、子列表

import { queryAll, queryOne } from '../../db';
import type { Collection } from '../../types';
import { collectionFromRow, type CollectionRow } from './rows';

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

