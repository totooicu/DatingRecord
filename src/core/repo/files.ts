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
import { isPrivacyMode } from '../../privacy';
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
  /** 隐私：开启隐私模式后默认隐藏 */
  isPrivate: boolean;
  /** 非空 = 映射文件：库里只存这个链接，二进制不落 IndexedDB */
  sourceUrl: string;
}

/** 映射文件？库里只有链接，没有二进制 */
export function isMappingFile(f: StoredFile): boolean {
  return !!f.sourceUrl;
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
  is_private: number;
  /** 非空 = 映射文件，库里不存二进制 */
  source_url: string | null;
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
    isPrivate: Number(r.is_private ?? 0) === 1,
    sourceUrl: r.source_url || '',
  };
}

export function listFiles(): StoredFile[] {
  return queryAll<FileRow>(
    `SELECT id, stored_id, name, mime, size, sha256, hash_shared, created_at, is_private, source_url FROM attachments
       ${isPrivacyMode() ? "WHERE is_private = 0" : ''}
     ORDER BY created_at DESC`,
  ).map(fromRow);
}

export function getFile(id: string): StoredFile | null {
  const r = queryOne<FileRow>(
    'SELECT id, stored_id, name, mime, size, sha256, hash_shared, created_at, is_private, source_url FROM attachments WHERE id = ?',
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

/** 映射文件：只落一条元数据 + 链接，不写 IndexedDB 二进制 */
export interface MappedFileInput {
  name: string;
  sourceUrl: string;
  storedId: string;
  mime: string;
  /** 远端大小（探测/下载时知道才填；不知道就 0） */
  size?: number;
  sha256?: string;
}

export function insertMappedFile(input: MappedFileInput): StoredFile {
  const id = newId('f');
  const now = new Date().toISOString();
  transact(() => {
    run(
      `INSERT INTO attachments (id, stored_id, sha256, mime, name, data, size, taken_at, created_at, hash_shared, source_url)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.storedId,
        input.sha256 ?? '',
        input.mime,
        input.name,
        '',
        input.size ?? 0,
        null,
        now,
        0,
        input.sourceUrl,
      ],
    );
    appendOplog('attachment', id, 'insert', {
      name: input.name,
      mime: input.mime,
      storedId: input.storedId,
      sourceUrl: input.sourceUrl,
    });
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
    `SELECT id, stored_id, name, mime, size, sha256, hash_shared, created_at, is_private, source_url FROM attachments
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
      `SELECT id, stored_id, name, mime, size, sha256, hash_shared, created_at, is_private, source_url FROM attachments
       WHERE stored_id = ? ORDER BY created_at ASC LIMIT 1`,
      [k],
    ) ??
    queryOne<FileRow>(
      `SELECT id, stored_id, name, mime, size, sha256, hash_shared, created_at, is_private, source_url FROM attachments
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
    'SELECT id, stored_id, name, mime, size, sha256, hash_shared, created_at, is_private, source_url FROM attachments',
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
 * 头像 / 图标引用：把该文件设为头像或人物图标的人物。
 *
 * 注意 persons.avatar 存的是 `file:<文件id>`，不是引用名；新的人物图标
 * 存在 icon_json.fileId。两处都要算，否则文件管理会漏报、孤儿回收会误删。
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
     WHERE deleted_at IS NULL
       AND (avatar = ? OR avatar = ? OR json_extract(icon_json, '$.fileId') = ?)
     ORDER BY display_name ASC`,
    [`file:${id}`, id, id],
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
  // 事件正文在 events.content；聊天形式的事件把每条消息放在 event_messages.body，
  // 两处都要算，否则聊天里插入的图片会被当成「未被引用」，孤儿回收时直接删掉。
  const evWhere = keys.map(() => 'content LIKE ?').join(' OR ');
  const msgWhere = keys.map(() => 'body LIKE ?').join(' OR ');
  return queryAll<{ id: string; title: string; start_ts: number | null; created_at: string }>(
    `SELECT id, title, start_ts, created_at FROM events e
     WHERE deleted_at IS NULL
       AND (${evWhere} OR EXISTS (
         SELECT 1 FROM event_messages m
         WHERE m.event_id = e.id AND m.deleted_at IS NULL AND (${msgWhere})
       ))
       ${isPrivacyMode() ? 'AND is_private = 0' : ''}
     ORDER BY COALESCE(start_ts, 0) DESC, created_at DESC`,
    [...keys, ...keys].map((k) => `%${FILE_REF_PREFIX}${k}%`),
  ).map((r) => ({
    id: r.id,
    title: r.title || '（无标题）',
    startTs: r.start_ts === null ? null : Number(r.start_ts),
    createdAt: r.created_at,
  }));
}

/**
 * 把该文件当作图标的事件集（F-C08）。
 *
 * svg / image 两类图标存的是 attachments.id，所以按 id 精确匹配；
 * 这里返回集合名，让文件管理能明确写出「被「初恋」用作图标」，
 * 而不是含糊的「未被引用」。
 */
export interface FileRefCollection {
  id: string;
  name: string;
}

export function collectionsUsingFile(file: StoredFile | string): FileRefCollection[] {
  const id = typeof file === 'string' ? file : file.id;
  if (!id) return [];
  // 这里**不**过滤隐私：和「谁在用这个文件」的语义要对齐 ——
  // 被隐私集合用着的文件，删除/回收时必须仍然算作「被引用」，
  // 否则一开隐私模式就会把它当孤儿删掉。只遮名字里的敏感信息是没意义的（文件名本来也可见）。
  return queryAll<{ id: string; name: string }>(
    `SELECT id, name FROM collections
     WHERE deleted_at IS NULL AND json_extract(icon_json, '$.fileId') = ?
     ORDER BY name ASC`,
    [id],
  ).map((r) => ({ id: r.id, name: r.name || '（未命名）' }));
}

/**
 * 有多少个事件在正文里引用了这个文件（用于删除前的提示）。
 *
 * 注意这里**只数事件正文**：集合图标不计入，因为
 * 「被 N 处正文引用」这句话在界面上是给正文用的；图标另有 collectionsUsingFile 单独展示。
 * 但孤儿回收必须把图标算进去（见 fileGc.ts），否则换个图标就把图片删了。
 */
export function countRefs(file: StoredFile | string): number {
  return eventsReferencingFile(file).length;
}

/** 渲染用：拿到可放进 <img src> 的地址。映射文件直接返回源链接 */
export async function urlForFile(id: string): Promise<string | null> {
  const mapped = getFile(id);
  if (mapped?.sourceUrl) return mapped.sourceUrl;
  return objectUrlFor(id);
}

/** 标记 / 取消隐私（隐私模式下的隐藏开关）。单独一个函数，避免污染其它写操作 */
export function setFilePrivate(id: string, on: boolean): void {
  // 值没变就别写（幂等）：重复点一下不该多一条撤销记录
  const cur = queryOne<{ is_private: number | null }>('SELECT is_private FROM attachments WHERE id = ?', [id]);
  if (!cur || Number(cur.is_private ?? 0) === (on ? 1 : 0)) return;
  transact(() => {
    run('UPDATE attachments SET is_private = ? WHERE id = ?', [on ? 1 : 0, id]);
    appendOplog('attachment', id, 'update', { isPrivate: on });
  });
}

/**
 * 重命名：只动元数据里的 name，id 与二进制都不变。
 *
 * 引用靠 file:<storedId> 定位，方括号里的名字只是插入时的快照，
 * 所以**不重写正文**：改完名，既有引用照旧能打开，显示的也还是当初那个名字。
 * 想让旧引用也换成新名字，得在文件页里手动合并 / 转移。
 */
export function renameFile(id: string, name: string): void {
  const n = name.trim();
  if (!n) return;
  transact(() => {
    run('UPDATE attachments SET name = ? WHERE id = ?', [n, id]);
    appendOplog('attachment', id, 'update', { name: n });
  });
}

/** 方括号里的名字只做最小转义：别让文件名里的 `[` `]` 破坏链接语法 */
function bracketLabel(name: string): string {
  return name.replace(/\\/g, '\\\\').replace(/[[\]]/g, '\\$&').replace(/\r?\n/g, ' ');
}

/**
 * 生成插入正文的引用片段。
 *
 * 方括号写**用户看到的文件名**，方便在纯文本/源码里认出这是哪个附件；
 * 定位文件仍只靠括号后的 file:<storedId>。因此：
 *   · 改文件名不需要重写正文（旧名字留在方括号里不影响打开），
 *   · 只有 hash 名（storedId）变了才需要改写（合并 / 批量转移时做）。
 * 老数据里的 `[](...)` 空方括号照旧可用，渲染时回退到文件库当前名字。
 */
export function fileRefSyntax(f: StoredFile): string {
  const bang = f.mime.startsWith('image/') ? '!' : '';
  return `${bang}[${bracketLabel(f.name)}](${FILE_REF_PREFIX}${f.storedId})`;
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
