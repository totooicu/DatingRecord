// 文件仓储：单层（无文件夹）的附件管理，供事件正文引用。
//
// 分工：元数据（名称/类型/大小/时间）存 SQLite attachments 表，
// 二进制存 IndexedDB blobs store —— 后者详见 core/db/blob.ts 的说明。
// 表里的 data 列不再写内容（历史上是 base64），只在导出备份时临时填充。
//
// 内容寻址（schema v2）：
//   stored_id   正文引用里用的名字，由内容 hash 生成（sha-xxx.jpg）
//   name        用户看到的实际名，随时可改，与引用无关
//   hash_shared 1 = 与别的行同 hash 但内容不同（用户确认过碰撞）
// 上传判重、迁移、合并的逻辑都在 core/files/ 下，这里只负责读写库。

import { queryAll, queryOne, run, transact, appendOplog } from '../db';
import { putBlob, delBlob, objectUrlFor, forgetUrl } from '../db/blob';
import { newId } from '../id';
import { FILE_REF_PREFIX } from '../markdown';

export interface StoredFile {
  id: string;
  /** 引用名（hash 名），正文里 file:<storedId> 用的就是它 */
  storedId: string;
  /** 实际名，用户可见、可改 */
  name: string;
  mime: string;
  size: number;
  sha256: string;
  /** 同 hash 但内容不同（用户确认碰撞） */
  hashShared: boolean;
  createdAt: string;
}

interface FileRow {
  id: string;
  stored_id: string | null;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  hash_shared: number | null;
  created_at: string;
}

function fromRow(r: FileRow): StoredFile {
  return {
    id: r.id,
    // 老库没跑完迁移时 stored_id 会是空的，退回 id：语义等同「老的引用名」
    storedId: r.stored_id || r.id,
    name: r.name,
    mime: r.mime,
    size: Number(r.size ?? 0),
    sha256: r.sha256 ?? '',
    hashShared: Number(r.hash_shared ?? 0) === 1,
    createdAt: r.created_at ?? '',
  };
}

export function listFiles(): StoredFile[] {
  return queryAll<FileRow>(
    'SELECT id, stored_id, name, mime, size, sha256, hash_shared, created_at FROM attachments ORDER BY created_at DESC',
  ).map(fromRow);
}

export function getFile(id: string): StoredFile | null {
  const r = queryOne<FileRow>(
    'SELECT id, stored_id, name, mime, size, sha256, hash_shared, created_at FROM attachments WHERE id = ?',
    [id],
  );
  return r ? fromRow(r) : null;
}

/** 原样插入一条附件记录（不做判重）。判重逻辑见 core/files/upload.ts */
export interface RawFileInput {
  file: Blob;
  name: string;
  storedId: string;
  sha256: string;
  hashShared?: boolean;
  createdAt?: string;
}

export async function insertFileRaw(input: RawFileInput): Promise<StoredFile> {
  const id = newId('f');
  const mime = input.file.type || 'application/octet-stream';
  const now = input.createdAt ?? new Date().toISOString();
  await putBlob(id, input.file);
  transact(() => {
    run(
      `INSERT INTO attachments (id, stored_id, sha256, mime, name, data, size, taken_at, created_at, hash_shared)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, input.storedId, input.sha256, mime, input.name, '', input.file.size, null, now, input.hashShared ? 1 : 0],
    );
    appendOplog('attachment', id, 'insert', { name: input.name, size: input.file.size, mime, storedId: input.storedId });
  });
  return getFile(id)!;
}

/** 改引用名（迁移/合并用）；正文里已有的旧引用需要调用方自己替换 */
export function setStoredId(id: string, storedId: string, hashShared?: boolean): void {
  transact(() => {
    if (hashShared === undefined) {
      run('UPDATE attachments SET stored_id = ? WHERE id = ?', [storedId, id]);
    } else {
      run('UPDATE attachments SET stored_id = ?, hash_shared = ? WHERE id = ?', [storedId, hashShared ? 1 : 0, id]);
    }
    appendOplog('attachment', id, 'update', { storedId, hashShared });
  });
}

/** 写回算出来的 hash（迁移里给老文件补 sha256 用） */
export function setFileHash(id: string, sha256: string): void {
  transact(() => {
    run('UPDATE attachments SET sha256 = ? WHERE id = ?', [sha256, id]);
    appendOplog('attachment', id, 'update', { sha256 });
  });
}

/** 同 hash 且未标记碰撞的行（判重的候选集合） */
export function filesByHash(sha256: string): StoredFile[] {
  if (!sha256) return [];
  return queryAll<FileRow>(
    `SELECT id, stored_id, name, mime, size, sha256, hash_shared, created_at FROM attachments
     WHERE sha256 = ? AND hash_shared = 0 ORDER BY created_at ASC`,
    [sha256],
  ).map(fromRow);
}

/**
 * 按引用名找文件。
 *
 * stored_id 是内容寻址之后的名字；老库里的引用写的是老 id，所以这里必须
 * 两级回退（stored_id → id），否则从旧备份导入的正文会整片变成「附件已删除」。
 */
export function fileByStoredId(key: string): StoredFile | null {
  const k = key.trim();
  if (!k) return null;
  const r =
    queryOne<FileRow>(
      `SELECT id, stored_id, name, mime, size, sha256, hash_shared, created_at FROM attachments
       WHERE stored_id = ? ORDER BY created_at ASC LIMIT 1`,
      [k],
    ) ??
    queryOne<FileRow>(
      `SELECT id, stored_id, name, mime, size, sha256, hash_shared, created_at FROM attachments
       WHERE id = ? LIMIT 1`,
      [k],
    );
  return r ? fromRow(r) : null;
}

/** 按引用名批量取 id（渲染层把正文里的 file:<key> 映射成真实 id） */
export function resolveFileIds(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const f = fileByStoredId(k);
    if (f) out[k] = f.id;
  }
  return out;
}

/** 所有引用名占用情况（挑新名字时用） */
export function nameSlots(excludeId?: string): { storedId: string; hashShared: boolean; id: string }[] {
  return queryAll<FileRow>(
    'SELECT id, stored_id, name, mime, size, sha256, hash_shared, created_at FROM attachments',
  )
    .map(fromRow)
    .filter((f) => f.id !== excludeId)
    .map((f) => ({ id: f.id, storedId: f.storedId, hashShared: f.hashShared }));
}

/** 彻底删除：元数据、二进制、objectURL 缓存三处一起清 */
export async function deleteFile(id: string): Promise<void> {
  await delBlob(id);
  forgetUrl(id);
  transact(() => {
    run('DELETE FROM attachments WHERE id = ?', [id]);
    appendOplog('attachment', id, 'delete', { id, hard: true });
  });
}

/**
 * 引用查询的唯一入口：文件被哪些未删除的事件在正文里引用了。
 *
 * countRefs 与 eventsReferencingFile 必须同源，否则会出现
 * 「被 3 个事件引用」点开只有 2 条这种对不上的情况。
 *
 * 老数据里正文写的是 file:<老id>，新数据是 file:<storedId>，
 * 所以两个名字都要匹配（用 / 分隔的正则串做不到，直接两次 LIKE 拼起来）。
 */
/**
 * 头像引用：把该文件设为头像的人物。
 *
 * 注意 persons.avatar 存的是 `file:<文件id>`（见 AvatarPicker.pick），
 * 不是引用名。所以这里按 id 匹配，同时兼容极少数只存裸 id 的老数据。
 */
export interface FileRefPerson {
  id: string;
  displayName: string;
}

export function personsUsingFile(file: StoredFile | string): FileRefPerson[] {
  const id = typeof file === 'string' ? file : file.id;
  if (!id) return [];
  return queryAll<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM persons
     WHERE deleted_at IS NULL AND (avatar = ? OR avatar = ?)
     ORDER BY display_name ASC`,
    [`file:${id}`, id],
  ).map((r) => ({ id: r.id, displayName: r.display_name || '（未命名）' }));
}

export interface FileRefEvent {
  id: string;
  title: string;
  startTs: number | null;
  createdAt: string;
}

export function eventsReferencingFile(file: StoredFile | string): FileRefEvent[] {
  const keys =
    typeof file === 'string'
      ? [file]
      : Array.from(new Set([file.storedId, file.id].filter(Boolean)));
  if (keys.length === 0) return [];
  const where = keys.map(() => 'content LIKE ?').join(' OR ');
  return queryAll<{ id: string; title: string; start_ts: number | null; created_at: string }>(
    `SELECT id, title, start_ts, created_at FROM events
     WHERE deleted_at IS NULL AND (${where})
     ORDER BY COALESCE(start_ts, 0) DESC, created_at DESC`,
    keys.map((k) => `%${FILE_REF_PREFIX}${k}%`),
  ).map((r) => ({
    id: r.id,
    title: r.title || '（无标题）',
    startTs: r.start_ts === null ? null : Number(r.start_ts),
    createdAt: r.created_at,
  }));
}

/** 有多少个事件在正文里引用了这个文件（用于删除前的提示） */
export function countRefs(file: StoredFile | string): number {
  return eventsReferencingFile(file).length;
}

/** 渲染用：拿到可放进 <img src> 的 objectURL */
export function urlForFile(id: string): Promise<string | null> {
  return objectUrlFor(id);
}

/**
 * 重命名：只动元数据里的 name，id 与二进制都不变。
 *
 * 正文里存的是 file:<id>，名字压根没写进引用里（见 fileRefSyntax），
 * 所以改名后所有既有引用照旧有效，显示的名字也自动跟着变。
 */
export function renameFile(id: string, name: string): void {
  const n = name.trim();
  if (!n) return;
  transact(() => {
    run('UPDATE attachments SET name = ? WHERE id = ?', [n, id]);
    appendOplog('attachment', id, 'update', { name: n });
  });
}

/**
 * 生成插入正文的引用片段。
 *
 * 方括号里**故意留空**——名字不写进正文，只靠 id 定位文件。
 * 否则改一次名字，正文里那串旧名字就成了永远对不上的死文字。
 * 显示时的名字由渲染层按 id 现查（见 renderMarkdown 的 nameMap）。
 */
export function fileRefSyntax(f: StoredFile): string {
  const bang = f.mime.startsWith('image/') ? '!' : '';
  return `${bang}[](${FILE_REF_PREFIX}${f.storedId})`;
}

/**
 * 触发下载，存成当前的文件名。
 *
 * objectURL 本身没有文件名（浏览器会拿一串随机 uuid 当名字），
 * 所以必须用 <a download> 才能把名字带下去。
 */
export function downloadFile(url: string, name: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 在新标签页打开（PDF、或用户想用浏览器自带能力看的时候） */
export function openInTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** 批量取文件名，供渲染层把 file:<id> 显示成当前名字 */
export function fileNames(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const f = getFile(id);
    if (f) out[id] = f.name;
  }
  return out;
}

export { delBlob, clearBlobs } from '../db/blob';
