// 事件集写入：新建 / 更新 / 移动 / 删除（移动要做环检测）

import { queryAll, queryOne, run, transact, appendOplog, getDeviceId } from '../../db';
import { newId } from '../../id';
import { hlcNow } from '../../time';
import { orderKeyBetween } from '../../order';
import type { Collection, CollectionIcon, CollectionKind, SmartRule } from '../../types';
import { rebuildClosure } from './closure';
import { getRoot, getCollection, listChildren } from './read';
import { isSmart } from './smart';

// ---------------- 写操作 ----------------

export function createCollection(input: {
  name: string;
  parentId?: string | null;
  kind?: CollectionKind;
  description?: string;
  /** 智能集合的匹配规则；普通集合忽略 */
  rule?: SmartRule | null;
}): Collection {
  const id = newId('c');
  const now = new Date().toISOString();
  const parentId = input.parentId ?? getRoot()?.id ?? null;
  const siblings = parentId ? listChildren(parentId) : [];
  const lastKey = siblings.length ? siblings[siblings.length - 1].orderKey : null;
  const rule = input.kind === 'smart' ? input.rule ?? {} : null;

  transact(() => {
    run(
      `INSERT INTO collections
       (id,name,kind,parent_id,order_key,description,status,rule_json,is_root,time_range_auto,device_id,rev,hlc,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.name,
        input.kind ?? 'arc',
        parentId,
        orderKeyBetween(lastKey, null),
        input.description ?? '',
        'ongoing',
        rule ? JSON.stringify(rule) : null,
        0,
        1,
        getDeviceId(),
        1,
        hlcNow(getDeviceId()),
        now,
        now,
      ],
    );
    appendOplog('collection', id, 'insert', { name: input.name, parentId, kind: input.kind ?? 'arc' });
  });
  rebuildClosure();
  return getCollection(id)!;
}

export function updateCollection(
  id: string,
  patch: Partial<Pick<Collection, 'name' | 'description' | 'status' | 'kind' | 'cover' | 'rule' | 'icon'>>,
): void {
  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());
  transact(() => {
    const c = getCollection(id);
    if (!c) return;
    // 智能集合的成员是算出来的，不允许手动挂；把集合改成智能时清掉旧成员，
    // 改回普通时成员早就手动加回去了，这里不用管。
    if (patch.kind !== undefined && patch.kind !== c.kind && isSmart({ kind: patch.kind })) {
      run('UPDATE collection_members SET deleted_at = ? WHERE collection_id = ?', [now, id]);
    }
    const rule = 'rule' in patch ? patch.rule : c.rule;
    const icon = 'icon' in patch ? patch.icon : c.icon;
    run(
      `UPDATE collections SET name=?, description=?, status=?, kind=?, cover=?, rule_json=?, icon_json=?,
                             rev=rev+1, hlc=?, updated_at=? WHERE id=?`,
      [
        patch.name ?? c.name,
        patch.description ?? c.description,
        patch.status ?? c.status,
        patch.kind ?? c.kind,
        patch.cover ?? c.cover ?? null,
        rule ? JSON.stringify(rule) : null,
        icon ? JSON.stringify(icon) : null,
        hlc,
        now,
        id,
      ],
    );
    // title 给撤销提示条用：改名时是新名，改规则/状态时用当前名（撤销回滚由快照负责）
    appendOplog('collection', id, 'update', { ...patch, title: patch.name ?? c.name });
  });
}

/**
 * 设置 / 清除事件集图标（F-C08）。
 *
 * 单独一个函数而不是走 updateCollection：图标是纯展示属性，改它不该惊动
 * 名称/状态/成员，撤销提示条也要说人话（「更换事件集图标」而不是「修改事件集」）。
 * 传 null 表示恢复默认外观。
 */
export function setCollectionIcon(id: string, icon: CollectionIcon | null): void {
  const now = new Date().toISOString();
  const c = getCollection(id);
  if (!c) return;
  const before = JSON.stringify(c.icon ?? null);
  if (before === JSON.stringify(icon ?? null)) return; // 幂等：没变就不落 oplog
  transact(() => {
    run(
      'UPDATE collections SET icon_json = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?',
      [icon ? JSON.stringify(icon) : null, hlcNow(getDeviceId()), now, id],
    );
    appendOplog('collection', id, 'update', {
      title: c.name,
      icon: icon ? { type: icon.type } : null,
    });
  });
}

/**
 * 设置 / 清除事件集模板事件（v13）。
 *
 * 单独一个函数而不是走 updateCollection：模板是「新建事件时的默认值」，
 * 改它不该惊动名称/状态/成员，撤销提示条也要说人话。
 * 只校验事件当前存在（回收站里的不算）；传 null 表示不套模板。
 */
export function setCollectionTemplate(id: string, eventId: string | null): void {
  const c = getCollection(id);
  if (!c) return;
  const next = eventId || null;
  if ((c.templateEventId ?? null) === next) return; // 幂等：没变就不落 oplog
  if (next) {
    // 直接查表而不是 import getEvent：collections → events 已有读取依赖，
    // 写侧再反向引用会绕成环；这里只需要「这条事件还在不在」。
    const hit = queryOne<{ id: string }>(
      'SELECT id FROM events WHERE id = ? AND deleted_at IS NULL',
      [next],
    );
    if (!hit) throw new Error(`模板事件不存在或已删除：${next}`);
  }
  const now = new Date().toISOString();
  transact(() => {
    run(
      'UPDATE collections SET template_event_id = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?',
      [next, hlcNow(getDeviceId()), now, id],
    );
    appendOplog('collection', id, 'update', {
      title: c.name,
      templateEventId: next,
    });
  });
}

/** 标记 / 取消隐私（隐私模式下的隐藏开关）。单独一个函数，避免污染 updateCollection 的字段清单 */
export function setCollectionPrivate(id: string, on: boolean): void {
  const now = new Date().toISOString();
  // 值没变就别写（幂等）：否则重复点一下按钮也会多一条 oplog，
  // 撤销提示条里冒出一条什么都没改的「修改…」
  const cur = queryOne<{ is_private: number | null }>('SELECT is_private FROM collections WHERE id = ?', [id]);
  if (!cur || Number(cur.is_private ?? 0) === (on ? 1 : 0)) return;
  transact(() => {
    run('UPDATE collections SET is_private = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
      on ? 1 : 0,
      hlcNow(getDeviceId()),
      now,
      id,
    ]);
    appendOplog('collection', id, 'update', { isPrivate: on });
  });
}

/** 从归档恢复：status 回到「进行中」，成员关系本来就没动过 */
export function restoreCollection(id: string): void {
  updateCollection(id, { status: 'ongoing' });
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

