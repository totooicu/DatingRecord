// 闭包表：用 ancestor/descendant 全路径换取无限层级的一次查询。
// 每次结构变动都要 rebuildClosure() 重建，读侧才能直接 JOIN。

import { queryAll, run } from '../../db';

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
