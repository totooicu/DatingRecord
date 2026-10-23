// 事件集读取：树、面包屑、子列表

import { queryAll, queryOne } from '../../db';
import type { Collection } from '../../types';
import { collectionFromRow, type CollectionRow } from './rows';
import { isSmart, listSmartEvents } from './smart';
import { isPrivacyMode } from '../../../privacy';

// ---------------- 查询 ----------------

export function getRoot(): Collection | null {
  // 多个根（合并导入别的库时会带进来第二棵根）时固定取最早创建的那棵，
  // 否则 LIMIT 1 没有 ORDER BY，取哪棵由 SQLite 心情决定，树会时有时无。
  const row = queryOne<CollectionRow>(
    'SELECT * FROM collections WHERE is_root = 1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1',
  );
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
  // 隐私模式下把私有集合整棵摘掉（含其子孙——它们同样被 filter 掉了）
  const all = rows.map(collectionFromRow).filter((c) => !c.isPrivate || !isPrivacyMode());
  const counts = new Map<string, number>();
  for (const row of queryAll<{ collection_id: string; c: number }>(
    `SELECT m.collection_id AS collection_id, COUNT(*) AS c
     FROM collection_members m
     JOIN events e ON e.id = m.member_id AND e.deleted_at IS NULL
       ${isPrivacyMode() ? 'AND e.is_private = 0' : ''}
     WHERE m.member_type = 'event' AND m.deleted_at IS NULL
     GROUP BY m.collection_id`,
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
       ${isPrivacyMode() ? 'AND e.is_private = 0' : ''}
     GROUP BY cl.ancestor_id`,
  )) {
    totals.set(row.ancestor_id, row.c);
  }

  const build = (c: Collection): TreeNode => {
    // 智能集合的成员一条都不落库，计数只能现算，否则树里永远显示 0
    const n = isSmart(c) ? listSmartEvents(c).length : (counts.get(c.id) ?? 0);
    return {
      ...c,
      children: all.filter((x) => x.parentId === c.id).map(build),
      eventCount: n,
      totalEventCount: isSmart(c) ? n : (totals.get(c.id) ?? 0),
    };
  };
  return build(root);
}

/** 归档的事件集：只改了 status，成员与事件都还在，可原样恢复 */
export function listArchivedCollections(): Collection[] {
  return queryAll<CollectionRow>(
    `SELECT * FROM collections WHERE deleted_at IS NULL AND status = 'archived'
       ${isPrivacyMode() ? 'AND is_private = 0' : ''}
     ORDER BY updated_at DESC`,
  ).map(collectionFromRow);
}

export function getBreadcrumb(id: string): Collection[] {
  const rows = queryAll<{ ancestor_id: string }>(
    'SELECT ancestor_id FROM collection_closure WHERE descendant_id = ? ORDER BY depth DESC',
    [id],
  );
  return rows.map((r) => getCollection(r.ancestor_id)).filter((c): c is Collection => !!c);
}

/**
 * 给定若干集合，返回它们**连同全部子孙**的 id 集合（闭包表一次查询）。
 *
 * 日历/时间线的「按事件集筛选」要含嵌套层级：选了「旅行」，
 * 「旅行 / 日本」下的事件也该出现，否则层级越深越筛不出东西。
 */
export function descendantIdsOf(ids: string[]): Set<string> {
  const out = new Set(ids);
  if (ids.length === 0) return out;
  const marks = ids.map(() => '?').join(',');
  for (const row of queryAll<{ descendant_id: string }>(
    `SELECT DISTINCT descendant_id FROM collection_closure WHERE ancestor_id IN (${marks})`,
    ids,
  )) {
    out.add(row.descendant_id);
  }
  return out;
}

export function listChildren(parentId: string): Collection[] {
  return queryAll<CollectionRow>(
    `SELECT * FROM collections WHERE parent_id = ? AND deleted_at IS NULL
       ${isPrivacyMode() ? 'AND is_private = 0' : ''}
     ORDER BY order_key`,
    [parentId],
  ).map(collectionFromRow);
}

/**
 * 事件集总金额：把集合（含所有子集合）里事件的 metrics.cost 加起来。
 *
 * 智能集合不落成员，只能按规则现算；隐私模式下的私有事件不计入，
 * 与「含子集合的事件数」保持同一套过滤条件。
 */
export function collectionTotalCost(collection: Collection): number {
  if (isSmart(collection)) {
    return listSmartEvents(collection).reduce((sum, e) => sum + (Number(e.metrics?.cost) || 0), 0);
  }
  const row = queryOne<{ cost: number | null }>(
    `SELECT COALESCE(SUM(c), 0) AS cost FROM (
       SELECT MAX(json_extract(e.metrics_json, '$.cost')) AS c
       FROM collection_closure cl
       JOIN collection_members m ON m.collection_id = cl.descendant_id
       JOIN events e ON e.id = m.member_id
       WHERE cl.ancestor_id = ? AND m.member_type = 'event' AND m.deleted_at IS NULL
         AND e.deleted_at IS NULL
         ${isPrivacyMode() ? 'AND e.is_private = 0' : ''}
       GROUP BY e.id
     )`,
    [collection.id],
  );
  return Number(row?.cost ?? 0);
}

