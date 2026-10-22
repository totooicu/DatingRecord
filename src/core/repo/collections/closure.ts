// 闭包表：用 ancestor/descendant 全路径换取无限层级的一次查询。
// 每次结构变动都要 rebuildClosure() 重建，读侧才能直接 JOIN。

import { queryAll, run, getDeviceId } from '../../db';
import { newId } from '../../id';
import { hlcNow } from '../../time';
import { FIRST_ORDER_KEY } from '../../order';

export function rebuildClosure(): void {
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

export function ensureClosure(): void {
  rebuildClosure();
}

/**
 * 导入后的树修复：保证「只有一个根，且所有活着的集合都挂在这棵树上」。
 *
 * 合并导入另一个库时，备份里带着它自己的根集合（is_root = 1），
 * 于是库里出现两棵根。getTree 只从一棵根往下走，另一棵根下的整批
 * 事件集就会「凭空消失」——用户看到的就是导入后事件集丢了。
 * 这里把多余的根并回主根（子集合改挂主根），没有父的游离集合也挂回主根，
 * 否则它们同样不会出现在树里。
 */
export function normalizeCollectionTree(): void {
  const roots = queryAll<{
    id: string;
    name: string;
    icon_json: string | null;
    description: string | null;
    cover: string | null;
    status: string | null;
  }>(
    `SELECT id, name, icon_json, description, cover, status FROM collections
     WHERE is_root = 1 AND deleted_at IS NULL ORDER BY created_at ASC`,
  );

  let rootId = roots[0]?.id ?? null;
  if (!rootId) {
    // 老数据/异常备份可能一个根都没有：补一个，否则整棵树都不显示
    const any = queryAll<{ id: string }>('SELECT id FROM collections WHERE deleted_at IS NULL LIMIT 1');
    if (any.length > 0) {
      const now = new Date().toISOString();
      rootId = newId('c');
      run(
        `INSERT INTO collections
         (id,name,kind,parent_id,order_key,status,is_root,time_range_auto,device_id,rev,hlc,created_at,updated_at)
         VALUES (?,?,?,?,?,?,1,1,?,1,?,?,?)`,
        [rootId, '全部', 'root', null, FIRST_ORDER_KEY, 'ongoing', getDeviceId(), hlcNow(getDeviceId()), now, now],
      );
    }
  }
  if (!rootId) {
    rebuildClosure();
    return;
  }

  for (const extra of roots.slice(1)) {
    // 主根还是默认外观（「全部」、无图标无描述）时，把备份根的外观接过来，
    // 免得用户导入后发现自己设置的根图标没了。
    const canonical = roots[0];
    const isDefault =
      canonical.name === '全部' && !canonical.icon_json && !canonical.description && !canonical.cover;
    if (isDefault) {
      run('UPDATE collections SET name=?, icon_json=?, description=?, cover=?, status=? WHERE id=?', [
        extra.name,
        extra.icon_json,
        extra.description,
        extra.cover,
        extra.status ?? 'ongoing',
        rootId,
      ]);
    }
    // 多余根的子孙改挂主根；多余根自己的成员关系没有意义，一并软删
    run('UPDATE collections SET parent_id = ? WHERE parent_id = ?', [rootId, extra.id]);
    run('UPDATE collection_members SET deleted_at = ? WHERE collection_id = ?', [
      new Date().toISOString(),
      extra.id,
    ]);
    run('DELETE FROM collections WHERE id = ?', [extra.id]);
  }

  // 父集合已被删掉 / 指向不存在的 id / 干脆没有父：挂回根，别让子树沉底
  run(
    `UPDATE collections SET parent_id = ? WHERE deleted_at IS NULL AND id <> ?
       AND parent_id IS NOT NULL
       AND parent_id NOT IN (SELECT id FROM collections WHERE deleted_at IS NULL)`,
    [rootId, rootId],
  );
  run('UPDATE collections SET parent_id = ? WHERE deleted_at IS NULL AND id <> ? AND parent_id IS NULL', [
    rootId,
    rootId,
  ]);

  rebuildClosure();
}
