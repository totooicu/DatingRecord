// 重复人物：检测与合并。
// 起因是 createPerson 早期没有重名校验，用户以为没建成又建了一次。

import { queryOne, run, transact, appendOplog, getDeviceId } from '../../db';
import { hlcNow } from '../../time';
import type { Person } from '../../types';
import { getPerson, listPersons, type PersonWithStats } from './read';
import { listDefs } from './attrs';

// ---------------- 重复人物：检测与合并 ----------------

/** 按显示名归一化分组，返回同名（重复）的活跃人物组 */
export function findDuplicatePersons(): PersonWithStats[][] {
  const all = listPersons({ includeArchived: false });
  const groups = new Map<string, PersonWithStats[]>();
  for (const p of all) {
    const key = p.displayName.trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  return Array.from(groups.values()).filter((g) => g.length > 1);
}

export interface MergeAttrChoice {
  key: string;
  label: string;
  /** 双方都有且值不同的字段，需要用户逐个拍板 */
  conflict: boolean;
  keepValue: unknown;
  dropValue: unknown;
}

export interface MergePreview {
  keep: Person;
  drop: Person;
  /** 被合并者的事件关联数（会全部转移到保留者名下） */
  dropEventCount: number;
  /** 保留者自己的事件关联数 */
  keepEventCount: number;
  /** 合并后的参与者将出现重复（同事件两人都有）的事件数：取保留者，删重复行 */
  bothEventCount: number;
  attrs: MergeAttrChoice[];
  dropOnlyTags: string[];
  dropOnlyAliases: string[];
}

export function previewMerge(keepId: string, dropId: string): MergePreview | null {
  const keep = getPerson(keepId);
  const drop = getPerson(dropId);
  if (!keep || !drop) return null;

  const one = (id: string) =>
    queryOne<{ c: number | null }>('SELECT COUNT(*) AS c FROM event_participants WHERE person_id = ?', [id]);
  const both = queryOne<{ c: number | null }>(
    `SELECT COUNT(*) AS c FROM event_participants a
     JOIN event_participants b ON a.event_id = b.event_id
     WHERE a.person_id = ? AND b.person_id = ?`,
    [dropId, keepId],
  );

  const defs = new Map(listDefs().map((d) => [d.key, d]));
  const keys = Array.from(new Set([...Object.keys(keep.attrs), ...Object.keys(drop.attrs)]));
  const attrs: MergeAttrChoice[] = keys.map((key) => {
    const kv = keep.attrs[key]?.v;
    const dv = drop.attrs[key]?.v;
    return {
      key,
      label: defs.get(key)?.label ?? key,
      conflict: kv !== undefined && dv !== undefined && JSON.stringify(kv) !== JSON.stringify(dv),
      keepValue: kv,
      dropValue: dv,
    };
  });

  return {
    keep,
    drop,
    dropEventCount: one(dropId)?.c ?? 0,
    keepEventCount: one(keepId)?.c ?? 0,
    bothEventCount: both?.c ?? 0,
    attrs,
    dropOnlyTags: drop.tags.filter((t) => !keep.tags.includes(t)),
    dropOnlyAliases: drop.aliases.filter((a) => !keep.aliases.includes(a) && a !== keep.displayName),
  };
}

/**
 * 把 drop 合并进 keep，然后软删除 drop。
 * 冲突字段按 choices 决定用哪边的值（'keep' | 'drop'）；未标记冲突的字段自动取有值的一方。
 * 全程一个事务：参与者转移、属性合并、墓碑、oplog 要么全成要么全不动。
 */
export function mergePersons(keepId: string, dropId: string, choices: Record<string, 'keep' | 'drop'>): void {
  const keep = getPerson(keepId);
  const drop = getPerson(dropId);
  if (!keep || !drop || keepId === dropId) return;

  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());

  transact(() => {
    // 1) 参与者转移。主键是 (event_id, person_id)：
    //    两人都在的事件先删 drop 那行，避免 UPDATE 撞主键。
    run(
      `DELETE FROM event_participants WHERE person_id = ? AND event_id IN
        (SELECT event_id FROM event_participants WHERE person_id = ?)`,
      [dropId, keepId],
    );
    run('UPDATE event_participants SET person_id = ? WHERE person_id = ?', [keepId, dropId]);

    // 2) 属性合并：keep 为基准，冲突按 choices，只在 drop 有值的字段并入
    const merged = { ...keep.attrs };
    for (const [key, av] of Object.entries(drop.attrs)) {
      if (merged[key] === undefined) {
        merged[key] = av;
      } else if (choices[key] === 'drop') {
        merged[key] = av;
      }
    }

    // 3) 标签 / 别名并集（drop 的名字进别名，避免再次搜不到）
    const tags = Array.from(new Set([...keep.tags, ...drop.tags]));
    const aliases = Array.from(
      new Set([...keep.aliases, ...drop.aliases, drop.displayName].filter((a) => a !== keep.displayName)),
    );

    run(
      `UPDATE persons SET attrs_json=?, tags_json=?, aliases_json=?, notes=?,
       rev=rev+1, hlc=?, updated_at=? WHERE id=?`,
      [JSON.stringify(merged), JSON.stringify(tags), JSON.stringify(aliases), keep.notes || drop.notes, hlc, now, keepId],
    );

    // 4) 属性历史跟随转移（不合并，只是改归属）
    run('UPDATE person_attr_history SET person_id = ? WHERE person_id = ?', [keepId, dropId]);

    // 5) 墓碑：软删除，符合「永不物理删除」的同步铁律
    run(
      `UPDATE persons SET deleted_at = ?, status = 'archived', rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?`,
      [now, hlcNow(getDeviceId()), now, dropId],
    );

    appendOplog('person', keepId, 'update', { mergedFrom: dropId });
    appendOplog('person', dropId, 'delete', { id: dropId, mergedInto: keepId });
  });
}
