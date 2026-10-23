// 文件合并：把一批「内容重复」或「用户认定同源」的文件并到一个目标上。
//
// 合并要做的三件事（缺一不可）：
//   1. 正文里所有 file:<源引用名> 改成 file:<目标引用名>，事件本身不动
//   2. 头像如果指向源文件，改成指向目标文件
//   3. 删掉源文件的元数据与二进制
//
// 先预览后执行：previewMerge 只算不动，UI 用它把「改哪些事件、动几个头像」
// 摆给用户看，确认后再 commitMerge。迁移（migrate.ts）复用的就是这两个函数。

import { getBlob } from '../db/blob';
import { queryAll } from '../db';
import {
  deleteFile,
  eventsReferencingFile,
  getFile,
  personsUsingFile,
  type FileRefPerson,
  type StoredFile,
} from '../repo/files';
import { rewriteRefs } from './rewrite';
import { sameBytes } from './naming';

export interface MergeEventHit {
  id: string;
  title: string;
  /** 这条事件里引用了几处源文件 */
  count: number;
}

export interface MergePreview {
  target: StoredFile;
  sources: StoredFile[];
  /** 合并后会受影响的事件（去重后的并集） */
  events: MergeEventHit[];
  /** 头像指向源文件的人物名单（预览里要让用户看到会牵动谁） */
  avatarPersons: FileRefPerson[];
  /** 头像指向源文件的人物数 */
  avatars: number;
  /** 执行时会被删掉的二进制总字节 */
  freedBytes: number;
}

/** 统计一条事件正文里某个引用名出现了几次 */
function countRefOccurrences(md: string, name: string): number {
  if (!name) return 0;
  const re = new RegExp(`file:${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[)\\s])`, 'g');
  return (md.match(re) ?? []).length;
}

/**
 * 源文件里有几个人物头像 / 图标。
 *
 * 头像字段是 `file:<文件id>`，参数必须带前缀；人物图标存 icon_json.fileId。
 */
function avatarTargets(ids: string[]): number {
  if (ids.length === 0) return 0;
  const marks = ids.map(() => '?').join(',');
  const rows = queryAll<{ c: number | null }>(
    `SELECT COUNT(*) AS c FROM persons
     WHERE avatar IN (${marks}) OR json_extract(icon_json, '$.fileId') IN (${marks})`,
    [...ids.map((id) => `file:${id}`), ...ids],
  );
  return Number(rows[0]?.c ?? 0);
}

export function previewMerge(targetId: string, sourceIds: string[]): MergePreview | null {
  const target = getFile(targetId);
  if (!target) return null;
  const sources = sourceIds
    .filter((id) => id !== targetId)
    .map((id) => getFile(id))
    .filter((f): f is StoredFile => !!f);
  if (sources.length === 0) return null;

  const contents = new Map(
    queryAll<{ id: string; title: string; content: string }>(
      'SELECT id, title, content FROM events WHERE deleted_at IS NULL',
    ).map((r) => [r.id, r]),
  );

  const hits = new Map<string, MergeEventHit>();
  for (const s of sources) {
    for (const e of eventsReferencingFile(s)) {
      const md = contents.get(e.id)?.content ?? '';
      const add = countRefOccurrences(md, s.storedId) + countRefOccurrences(md, s.id);
      const prev = hits.get(e.id);
      if (prev) prev.count += add;
      else hits.set(e.id, { id: e.id, title: e.title, count: add });
    }
  }

  return {
    target,
    sources,
    events: Array.from(hits.values()).sort((a, b) => b.count - a.count),
    avatarPersons: sources.flatMap((s) => personsUsingFile(s)),
    avatars: avatarTargets(sources.map((s) => s.id)),
    freedBytes: sources.reduce((n, s) => n + s.size, 0),
  };
}

/**
 * 执行合并。
 *
 * 顺序很重要：先改引用（此时源文件还在，任何一步失败都能重来），
 * 最后才删源文件。删除走 deleteFile，它会同时清二进制与 objectURL 缓存。
 */
export async function commitMerge(targetId: string, sourceIds: string[]): Promise<void> {
  const target = getFile(targetId);
  if (!target) return;
  const sources = sourceIds
    .filter((id) => id !== targetId)
    .map((id) => getFile(id))
    .filter((f): f is StoredFile => !!f);
  if (sources.length === 0) return;

  rewriteRefs(
    sources.map((s) => ({ from: s.storedId, to: target.storedId, id: target.id, name: target.name })),
  );
  // 老数据的引用写的是老 id，也得一起替换
  rewriteRefs(
    sources.map((s) => ({ from: s.id, to: target.storedId, id: target.id, name: target.name })),
  );

  for (const s of sources) {
    await deleteFile(s.id);
  }
}

/**
 * 判断两个文件是否真的是同一份内容。
 *
 * 只有大小相同才可能相同；大小相同且够小就逐字节比，够大就退回「交给用户」。
 * 返回 true/false/ask 三态，让调用方能区分「确定不同」和「需要问人」。
 */
export async function sameContent(a: StoredFile, b: StoredFile, smallLimit: number): Promise<boolean | 'ask'> {
  if (a.size !== b.size) return false;
  if (Math.max(a.size, b.size) > smallLimit) return 'ask';
  const [ba, bb] = await Promise.all([getBlob(a.id), getBlob(b.id)]);
  if (!ba || !bb) return false;
  return sameBytes(ba, bb);
}

/** 目标文件是否还活着（合并前二次校验，防止弹窗开着时文件被删） */
export function targetAlive(id: string): boolean {
  return getFile(id) !== null;
}

/** 仅在需要时用到：把一组 id 的引用数一次算出来，避免逐条查库 */
export function refCounts(ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    const f = getFile(id);
    out[id] = f ? eventsReferencingFile(f).length : 0;
  }
  return out;
}

/** 合并后给一条可读的结果文案 */
export function mergeSummary(p: MergePreview): string {
  return `合并 ${p.sources.length} 个文件到「${p.target.name}」，涉及 ${p.events.length} 个事件、${p.avatars} 个头像，可释放 ${formatBytes(p.freedBytes)}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
