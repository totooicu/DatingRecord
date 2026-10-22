// 文件库体检：给「迁移」「合并」提供预览数据。
//
// 这里全是只读操作——算 hash、按 hash 分组、统计影响面——真正动数据的
// 地方在 migrate.ts / merge.ts。分开是为了让用户按确认之前能看全后果。

import { getBlob } from '../db/blob';
import { queryAll } from '../db';
import {
  delBlob,
  listFiles,
  setFileHash,
  eventsReferencingFile,
  personsUsingFile,
  type FileRefPerson,
  type StoredFile,
} from '../repo/files';
import { sha256Hex } from './naming';

/** 头像指向的文件（合并预览里列出人物名单用） */
export type { FileRefPerson } from '../repo/files';

/** 一个 hash 分组：内容相同的一批文件 */
export interface HashGroup {
  sha256: string;
  files: StoredFile[];
  /** 组内被正文引用的事件数（去重后的事件数，不是引用条数） */
  refEvents: number;
  /** 组内被用作头像的人物（合并预览要列出名单，不只给数字） */
  avatarPersons: FileRefPerson[];
  /** 组内被用作头像的人物数 */
  avatars: number;
  /** 组内文件大小是否全相同（不同则不能自动判定为同一份内容） */
  sameSize: boolean;
}

export interface AuditResult {
  total: number;
  /** 还没算过 hash 的文件 */
  noHash: number;
  /** 同 hash 的分组（每组 ≥2 个文件） */
  groups: HashGroup[];
  /** 引用名还不是 hash 名的文件数（老数据） */
  legacyNames: number;
}

/**
 * 有多少人物把这些文件设成了头像或人物图标。
 *
 * 头像字段存的是 `file:<文件id>`，所以参数要带上前缀再查；
 * 人物图标存的是 icon_json.fileId，按裸 id 匹配。
 */
function avatarCountOf(ids: string[]): number {
  if (ids.length === 0) return 0;
  const marks = ids.map(() => '?').join(',');
  const rows = queryAll<{ c: number | null }>(
    `SELECT COUNT(*) AS c FROM persons
     WHERE avatar IN (${marks}) OR json_extract(icon_json, '$.fileId') IN (${marks})`,
    [...ids.map((id) => `file:${id}`), ...ids],
  );
  return Number(rows[0]?.c ?? 0);
}

/** 给所有还没 hash 的文件补算 sha256（只改元数据，不动二进制） */
export async function hashMissingFiles(onStep?: (done: number, total: number) => void): Promise<number> {
  const todo = listFiles().filter((f) => !f.sha256);
  let done = 0;
  for (const f of todo) {
    const blob = await getBlob(f.id);
    if (blob) {
      const sha = await sha256Hex(blob);
      if (sha) setFileHash(f.id, sha);
    }
    done++;
    onStep?.(done, todo.length);
  }
  return done;
}

/** 体检：按 hash 分组并统计每组的影响面 */
export function auditFiles(): AuditResult {
  const files = listFiles();
  const byHash = new Map<string, StoredFile[]>();
  for (const f of files) {
    if (!f.sha256) continue;
    const arr = byHash.get(f.sha256) ?? [];
    arr.push(f);
    byHash.set(f.sha256, arr);
  }

  const groups: HashGroup[] = [];
  for (const [sha, arr] of byHash) {
    if (arr.length < 2) continue;
    const evs = new Set<string>();
    for (const f of arr) for (const e of eventsReferencingFile(f)) evs.add(e.id);
    groups.push({
      sha256: sha,
      files: arr,
      refEvents: evs.size,
      avatarPersons: arr.flatMap((f) => personsUsingFile(f)),
      avatars: avatarCountOf(arr.map((f) => f.id)),
      sameSize: arr.every((f) => f.size === arr[0].size),
    });
  }
  groups.sort((a, b) => b.files.length - a.files.length);

  return {
    total: files.length,
    noHash: files.filter((f) => !f.sha256).length,
    groups,
    legacyNames: files.filter((f) => !f.storedId.startsWith('sha-')).length,
  };
}

/** 删二进制（合并后清理多余文件用；元数据由调用方在同一事务里删） */
export async function dropBlob(id: string): Promise<void> {
  await delBlob(id);
}
