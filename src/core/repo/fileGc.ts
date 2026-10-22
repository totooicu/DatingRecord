// 附件回收（F-E05）：引用计数归零才清理
//
// 一条文件引用能出现在四个地方：
//   1. 事件正文里的 file:<storedId>（Markdown 内联图 / 下载链接）
//   2. 事件的 media_json（接口预留，目前 UI 还没写它，一起算上）
//   3. 人物头像 persons.avatar（存 file:<id>）
//   4. 事件集图标 collections.icon_json 的 fileId（F-C08，svg / image 两类）
//
// 只在**彻底删除事件**时自动回收。软删除不回收——回收站里的事件还能恢复，
// 恢复了引用还在；而 IndexedDB 里的二进制删了就是真没了（整库快照式撤销
// 只覆盖 SQLite 那一份，救不回 blob），所以编辑正文丢引用这类情况不自动删，
// 由文件管理里的「未被引用」标出来让人自己决定。

import { queryAll, queryOne, run, appendOplog } from '../db';
import { delBlob } from '../db/blob';
import { FILE_REF_PREFIX } from '../markdown';
import { fileByStoredId, getFile, type StoredFile } from './files';

const FILE_KEY_RE = /file:([A-Za-z0-9._-]+)/g;

/** 正文里出现过的所有 file:<key>（去重） */
export function extractFileKeys(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(FILE_KEY_RE)) out.add(m[1]);
  return [...out];
}

function parseMedia(mediaJson: string): string[] {
  try {
    const v = JSON.parse(mediaJson);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * 这个文件还有没有主。
 *
 * 回收站里的事件也算主——它随时可能被恢复，恢复后引用又回来了。
 * 宁可多留几天，不能把人还能找回的东西删了。
 */
export function fileStillReferenced(file: StoredFile): boolean {
  if (!file.id) return false;
  const avatar = queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM persons WHERE deleted_at IS NULL AND (avatar = ? OR avatar = ?)`,
    [`${FILE_REF_PREFIX}${file.id}`, file.id],
  );
  if (Number(avatar?.c ?? 0) > 0) return true;

  // 事件集图标：换个图标、删个集合，都不该把图片连坐删掉
  const icon = queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM collections
     WHERE deleted_at IS NULL AND json_extract(icon_json, '$.fileId') = ?`,
    [file.id],
  );
  if (Number(icon?.c ?? 0) > 0) return true;

  const keys = [file.storedId, file.id].filter(Boolean);
  const events = queryAll<{ content: string; media_json: string }>(
    'SELECT content, media_json FROM events',
  );
  for (const e of events) {
    for (const k of keys) {
      if (e.content.includes(`${FILE_REF_PREFIX}${k}`)) return true;
    }
    if (parseMedia(e.media_json).some((m) => keys.includes(m))) return true;
  }
  return false;
}

/**
 * 删文件行 + 二进制。还有主就留着，返回 false。
 *
 * 注意事务边界：这里只发裸 SQL，不再包 transact——sql.js 的事务不可重入，
 * 而唯一的调用方 purgeEvent 已经在一个事务里了。别处要用请自己包事务。
 */
export function deleteFileIfUnreferenced(id: string): boolean {
  const f = getFile(id);
  if (!f) return false;
  if (fileStillReferenced(f)) return false;
  run('DELETE FROM attachments WHERE id = ?', [id]);
  appendOplog('attachment', id, 'delete', { orphan: true });
  // blob 的删除不阻塞 SQL 事务：IndexedDB 这边失败也只是多留一份孤儿二进制，
  // 下次「未被引用」还能看见；反过来先删二进制再回滚事务就真丢了。
  void delBlob(id).catch(() => {});
  return true;
}

/**
 * 事件彻底消失后，回收只属于它的附件。
 *
 * 调用时机必须在事件行 DELETE 之后——那时「还有没有别的主」才是准的。
 * content / mediaJson 传删除前读到的值。返回被回收的文件 id。
 */
export function sweepEventFiles(content: string, mediaJson: string): string[] {
  const keys = new Set<string>([...extractFileKeys(content), ...parseMedia(mediaJson)]);
  const removed: string[] = [];
  for (const key of keys) {
    const f = fileByStoredId(key) ?? (key ? getFile(key) : null);
    if (f && deleteFileIfUnreferenced(f.id)) removed.push(f.id);
  }
  return removed;
}
