// 引用改写：把正文里的 file:<旧 id> 换成 file:<新 id>，顺带把方括号里的
// 显示名换成新文件的名字（hash 变了，名字通常也变了）。
//
// 三个地方都要用到（合并 / 迁移 / 批量转移），所以规则只写这一份：
//   · 只替换链接目标与方括号里的显示名，不碰正文其它任何文字
//   · 旧 id 后必须紧跟 `)` 或空白，否则 `A` 会误伤 `A_1`
//   · 兼容老数据里 file:<随机 id> 和空方括号的写法

import { queryAll, run, transact, appendOplog } from '../db';
import { FILE_REF_PREFIX } from '../markdown';
import { getDeviceId } from '../db/device';
import { hlcNow } from '../time';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 方括号内的显示名转义：`[` `]` 和反斜杠会破坏链接语法 */
function escapeLabel(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/[[\]]/g, '\\$&').replace(/\r?\n/g, ' ');
}

/** 一条文件引用：`![名字](file:id)` / `[名字](file:id)` */
const REF_BODY = '(?:\\\\.|[^\\\\\\]])*';

function refRe(from: string): RegExp {
  return new RegExp(
    `(!?)\\[(${REF_BODY})\\]\\(\\s*${escapeRe(FILE_REF_PREFIX)}${escapeRe(from)}\\s*\\)`,
    'g',
  );
}

/**
 * 把一个 id 的引用全部换成另一个 id。
 *
 * `toName` 给了就把方括号里的显示名一并换成它；不给则保留原文
 * （迁移只换 hash 名、文件没变，没必要动用户看到的名字）。
 */
export function replaceRef(md: string, from: string, to: string, toName?: string): string {
  if (!from || from === to) return md;
  return md.replace(refRe(from), (_m, bang: string, label: string) =>
    `${bang}[${toName === undefined ? label : escapeLabel(toName)}](${FILE_REF_PREFIX}${to})`,
  );
}

/** 正文里是否含某个引用（用 replaceRef 的同一套边界规则判断） */
export function hasRef(md: string, name: string): boolean {
  return new RegExp(
    `!?\\[${REF_BODY}\\]\\(\\s*${escapeRe(FILE_REF_PREFIX)}${escapeRe(name)}\\s*\\)`,
  ).test(md);
}

export interface RewriteReport {
  events: number;
  avatars: number;
  /** 被改写的图标（人物 + 事件集）数量 */
  icons: number;
}

export interface RefTarget {
  /** 要替换掉的旧引用 id（可能是老 id） */
  from: string;
  /** 新引用 id */
  to: string;
  /** 目标文件 id：头像存的是 id，合并时要跟着改 */
  id?: string;
  /** 目标文件名：给了就把方括号里的显示名一起换掉 */
  name?: string;
}

/**
 * 把引用名在全库范围内改掉（正文 + 头像）。
 *
 * 覆盖 events.content 与 persons.avatar —— 头像字段存的是 `file:<文件id>`，
 * 合并/迁移时不一起改，人物头像就会指向已经被删掉的那条记录。
 */
export function rewriteRefs(pairs: RefTarget[]): RewriteReport {
  const live = pairs.filter((p) => p.from && p.to && p.from !== p.to);
  if (live.length === 0) return { events: 0, avatars: 0, icons: 0 };

  const rows = queryAll<{ id: string; content: string }>(
    'SELECT id, content FROM events WHERE deleted_at IS NULL',
  );
  const persons = queryAll<{ id: string; avatar: string | null }>(
    'SELECT id, avatar FROM persons WHERE avatar IS NOT NULL',
  );
  // 图标（人物 / 事件集）存的是 attachments.id，不跟着改就会指向马上被删掉的源文件
  const personIcons = queryAll<{ id: string; icon_json: string }>(
    'SELECT id, icon_json FROM persons WHERE icon_json IS NOT NULL',
  );
  const collectionIcons = queryAll<{ id: string; icon_json: string }>(
    'SELECT id, icon_json FROM collections WHERE icon_json IS NOT NULL',
  );

  let events = 0;
  let avatars = 0;
  let icons = 0;
  const now = new Date().toISOString();
  transact(() => {
    for (const r of rows) {
      const before = r.content ?? '';
      let md = before;
      for (const p of live) md = replaceRef(md, p.from, p.to, p.name);
      if (md === before) continue;
      run('UPDATE events SET content = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
        md,
        hlcNow(getDeviceId()),
        now,
        r.id,
      ]);
      appendOplog('event', r.id, 'update', { reason: 'file-ref-rewrite' });
      events++;
    }
    for (const p of persons) {
      const av = matchAvatar(p.avatar ?? '', live);
      if (!av || av === p.avatar) continue;
      run('UPDATE persons SET avatar = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
        av,
        hlcNow(getDeviceId()),
        now,
        p.id,
      ]);
      appendOplog('person', p.id, 'update', { reason: 'avatar-rewrite' });
      avatars++;
    }
    for (const row of personIcons) {
      const next = rewriteIconJson(row.icon_json, live);
      if (!next) continue;
      run('UPDATE persons SET icon_json = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
        next,
        hlcNow(getDeviceId()),
        now,
        row.id,
      ]);
      appendOplog('person', row.id, 'update', { reason: 'icon-rewrite' });
      icons++;
    }
    for (const row of collectionIcons) {
      const next = rewriteIconJson(row.icon_json, live);
      if (!next) continue;
      run('UPDATE collections SET icon_json = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
        next,
        hlcNow(getDeviceId()),
        now,
        row.id,
      ]);
      appendOplog('collection', row.id, 'update', { reason: 'icon-rewrite' });
      icons++;
    }
  });
  return { events, avatars, icons };
}

/** 图标 JSON 里的 fileId 换成合并后的目标 id；没变化返回 null */
function rewriteIconJson(json: string, pairs: RefTarget[]): string | null {
  let icon: { fileId?: string } | null = null;
  try {
    icon = JSON.parse(json) as { fileId?: string };
  } catch {
    return null;
  }
  if (!icon?.fileId) return null;
  for (const p of pairs) {
    if (p.id && (icon.fileId === p.id || icon.fileId === p.from)) {
      if (icon.fileId === p.id) return null;
      return JSON.stringify({ ...icon, fileId: p.id });
    }
  }
  return null;
}

/**
 * 头像字符串 → 新头像值。
 *
 * persons.avatar 存的是 `file:<文件id>`（不是引用名），所以必须先剥掉前缀
 * 再按 id 匹配。之前直接拿 id 与 avatar 比较，永远匹配不上，
 * 结果合并时头像不跟着改，源文件一删头像就失效。
 */
function matchAvatar(avatar: string, pairs: RefTarget[]): string | null {
  if (!avatar) return null;
  const raw = avatar.startsWith('file:') ? avatar.slice(5) : avatar;
  for (const p of pairs) {
    if (raw === p.id || (p.from && raw === p.from)) return `file:${p.id}`;
  }
  return null;
}

/** 单个替换（改名场景） */
export function rewriteRefEverywhere(from: string, to: string): RewriteReport {
  return rewriteRefs([{ from, to }]);
}

/**
 * 批量转移：只改指定事件里对 from 的引用，换成 to，并把方括号里的名字
 * 更新成目标文件的名字。返回真正被改写的事件数。
 *
 * 与 rewriteRefs 的区别是**限定事件**——「谁在用」页里勾了哪几条就只动哪几条，
 * 头像 / 图标不动（那两处没有「选几条」的概念，交给合并处理）。
 */
export function transferRefsInEvents(
  eventIds: string[],
  from: string[],
  to: string,
  toName: string,
): number {
  const ids = Array.from(new Set(eventIds.filter(Boolean)));
  const keys = Array.from(new Set(from.filter(Boolean))).filter((k) => k !== to);
  if (ids.length === 0 || keys.length === 0) return 0;

  const marks = ids.map(() => '?').join(',');
  const rows = queryAll<{ id: string; content: string }>(
    `SELECT id, content FROM events WHERE deleted_at IS NULL AND id IN (${marks})`,
    ids,
  );
  let changed = 0;
  const now = new Date().toISOString();
  transact(() => {
    for (const r of rows) {
      const before = r.content ?? '';
      let md = before;
      for (const k of keys) md = replaceRef(md, k, to, toName);
      if (md === before) continue;
      run('UPDATE events SET content = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
        md,
        hlcNow(getDeviceId()),
        now,
        r.id,
      ]);
      appendOplog('event', r.id, 'update', { reason: 'file-ref-transfer' });
      changed++;
    }
  });
  return changed;
}
