// 事件集写入：新建 / 更新 / 移动 / 删除（移动要做环检测）

import { queryAll, run, transact, appendOplog, getDeviceId } from '../../db';
import { newId } from '../../id';
import { hlcNow } from '../../time';
import { orderKeyBetween } from '../../order';
import type { Collection, CollectionKind } from '../../types';
import { rebuildClosure } from './closure';
import { getRoot, getCollection, listChildren } from './read';

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

