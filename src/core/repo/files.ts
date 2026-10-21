// 文件仓储：单层（无文件夹）的附件管理，供事件正文引用。
//
// 分工：元数据（名称/类型/大小/时间）存 SQLite attachments 表，
// 二进制存 IndexedDB blobs store —— 后者详见 core/db/blob.ts 的说明。
// 表里的 data 列不再写内容（历史上是 base64），只在导出备份时临时填充。

import { queryAll, queryOne, run, transact, appendOplog } from '../db';
import { putBlob, delBlob, objectUrlFor, forgetUrl } from '../db/blob';
import { newId } from '../id';
import { FILE_REF_PREFIX } from '../markdown';

export interface StoredFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
}

interface FileRow {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  created_at: string;
}

function fromRow(r: FileRow): StoredFile {
  return {
    id: r.id,
    name: r.name,
    mime: r.mime,
    size: Number(r.size ?? 0),
    sha256: r.sha256 ?? '',
    createdAt: r.created_at ?? '',
  };
}

export function listFiles(): StoredFile[] {
  return queryAll<FileRow>(
    'SELECT id, name, mime, size, sha256, created_at FROM attachments ORDER BY created_at DESC',
  ).map(fromRow);
}

export function getFile(id: string): StoredFile | null {
  const r = queryOne<FileRow>(
    'SELECT id, name, mime, size, sha256, created_at FROM attachments WHERE id = ?',
    [id],
  );
  return r ? fromRow(r) : null;
}

/** 非安全上下文（局域网 http 打开）没有 crypto.subtle，算不出就留空，不影响使用 */
async function sha256Of(blob: Blob): Promise<string> {
  try {
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
}

/** 上传一个文件：二进制进 IndexedDB，元数据进库，全程一个事务 + oplog */
export async function addFile(file: File): Promise<StoredFile> {
  const id = newId('f');
  const sha = await sha256Of(file);
  const now = new Date().toISOString();
  await putBlob(id, file);
  transact(() => {
    run(
      'INSERT INTO attachments (id, sha256, mime, name, data, size, taken_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, sha, file.type || 'application/octet-stream', file.name, '', file.size, null, now],
    );
    appendOplog('attachment', id, 'insert', { name: file.name, size: file.size, mime: file.type });
  });
  return getFile(id)!;
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

/** 有多少个事件在正文里引用了这个文件（用于删除前的提示） */
export function countRefs(id: string): number {
  const r = queryOne<{ c: number | null }>(
    `SELECT COUNT(*) AS c FROM events
     WHERE deleted_at IS NULL AND content LIKE ?`,
    [`%${FILE_REF_PREFIX}${id}%`],
  );
  return r?.c ?? 0;
}

export interface FileRefEvent {
  id: string;
  title: string;
  startTs: number | null;
  createdAt: string;
}

/**
 * 引用该文件的事件列表（只含未删除的）。
 *
 * 和 countRefs 用同一个 LIKE 条件，两边的数字必须一致；
 * 点「被 N 处正文引用」时展示的就是这些事件。
 */
export function eventsReferencingFile(id: string): FileRefEvent[] {
  return queryAll<{ id: string; title: string; start_ts: number | null; created_at: string }>(
    `SELECT id, title, start_ts, created_at FROM events
     WHERE deleted_at IS NULL AND content LIKE ?
     ORDER BY COALESCE(start_ts, 0) DESC, created_at DESC`,
    [`%${FILE_REF_PREFIX}${id}%`],
  ).map((r) => ({
    id: r.id,
    title: r.title || '（无标题）',
    startTs: r.start_ts === null ? null : Number(r.start_ts),
    createdAt: r.created_at,
  }));
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
  return `${bang}[](${FILE_REF_PREFIX}${f.id})`;
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
