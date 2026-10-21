// 引用改写：把正文里的 file:<旧名> 换成 file:<新名>。
//
// 三个地方都要用到（改名 / 合并 / 迁移），所以规则只写这一份：
//   · 只替换链接目标里的那个名字，不碰正文其它任何文字
//   · 旧名后必须紧跟 `)` 或空白，否则 `A` 会误伤 `A_1`
//   · 同时兼容老数据里 file:<随机id> 的写法

import { queryAll, run, transact, appendOplog } from '../db';
import { FILE_REF_PREFIX } from '../markdown';
import { getDeviceId } from '../db/device';
import { hlcNow } from '../time';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 把一个名字的引用全部换成另一个名字（保留「?」后的可选项与空白） */
export function replaceRef(md: string, from: string, to: string): string {
  if (!from || from === to) return md;
  const re = new RegExp(`${escapeRe(FILE_REF_PREFIX)}${escapeRe(from)}(?=[)\\s])`, 'g');
  return md.replace(re, `${FILE_REF_PREFIX}${to}`);
}

/** 正文里是否含某个引用（用 replaceRef 的同一套边界规则判断） */
export function hasRef(md: string, name: string): boolean {
  const re = new RegExp(`${escapeRe(FILE_REF_PREFIX)}${escapeRe(name)}(?=[)\\s])`);
  return re.test(md);
}

export interface RewriteReport {
  events: number;
  avatars: number;
}

export interface RefTarget {
  /** 要替换掉的旧引用名（可能是老 id） */
  from: string;
  /** 新引用名 */
  to: string;
  /** 目标文件 id：头像存的是 id，合并时要跟着改 */
  id?: string;
}

/**
 * 把引用名在全库范围内改掉（正文 + 头像）。
 *
 * 覆盖 events.content 与 persons.avatar —— 头像字段存的是文件 id 而不是引用名，
 * 合并/迁移时不一起改，人物头像就会指向已经被删掉的那条记录。
 */
export function rewriteRefs(pairs: RefTarget[]): RewriteReport {
  const live = pairs.filter((p) => p.from && p.to && p.from !== p.to);
  if (live.length === 0) return { events: 0, avatars: 0 };

  const rows = queryAll<{ id: string; content: string }>(
    'SELECT id, content FROM events WHERE deleted_at IS NULL',
  );
  const persons = queryAll<{ id: string; avatar: string | null }>(
    'SELECT id, avatar FROM persons WHERE avatar IS NOT NULL',
  );

  let events = 0;
  let avatars = 0;
  const now = new Date().toISOString();
  transact(() => {
    for (const r of rows) {
      const before = r.content ?? '';
      let md = before;
      for (const p of live) md = replaceRef(md, p.from, p.to);
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
  });
  return { events, avatars };
}

/** 头像字符串 → 新 id：先按 id 命中，再按引用名命中 */
function matchAvatar(avatar: string, pairs: RefTarget[]): string | null {
  for (const p of pairs) {
    if (p.id && avatar === p.id) return p.id;
    if (avatar === p.from) return p.to;
  }
  return null;
}

/** 单个替换（改名场景） */
export function rewriteRefEverywhere(from: string, to: string): RewriteReport {
  return rewriteRefs([{ from, to }]);
}
