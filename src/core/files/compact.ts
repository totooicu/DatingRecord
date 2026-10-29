import { appendOplog, queryAll, run, transact } from '../db';
import { getDeviceId } from '../db/device';
import { hlcNow } from '../time';

export interface CompactChange { id: string; name: string; from: string; to: string }
type FileName = { id: string; name: string; stored_id: string };

export function planCompactNames(): CompactChange[] {
  const files = queryAll<FileName>('SELECT id, name, stored_id FROM attachments');
  const groups = new Map<string, { file: FileName; index: number; stem: string; ext: string }[]>();
  for (const file of files) {
    const match = /^(sha-[a-f0-9]{32})(?:_(\d+))?(\.[^/]+)?$/i.exec(file.stored_id || '');
    if (!match) continue;
    const index = match[2] === undefined ? -1 : Number(match[2]);
    if (!Number.isSafeInteger(index)) continue;
    const stem = match[1];
    const ext = match[3] || '';
    const key = (stem + ext).toLowerCase();
    const group = groups.get(key) || [];
    group.push({ file, index, stem, ext });
    groups.set(key, group);
  }
  const changes: CompactChange[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.index - b.index || a.file.id.localeCompare(b.file.id));
    group.forEach(({ file, ext }, i) => {
      const to = `${group[0].stem}${i === 0 ? '' : `_${i + 1}`}${ext}`;
      if (to !== file.stored_id) changes.push({ id: file.id, name: file.name, from: file.stored_id, to });
    });
  }
  return changes;
}

export function applyCompactNames(expected: CompactChange[]): number {
  const plan = planCompactNames();
  if (JSON.stringify(plan) !== JSON.stringify(expected)) throw new Error('文件库已变化，请重新预览');
  if (!plan.length) return 0;
  const map = new Map(plan.map(p => [p.from, p.to]));
  // 单次替换，不把 X_3→X_2 的结果再次当成旧 X_2 处理。
  const markdown = (text: string) => text.replace(/file:([^\s)"'<>]+)/g, (whole, key: string) => map.has(key) ? `file:${map.get(key)}` : whole);
  const reference = (text: string) => map.get(text) ?? markdown(text);
  const json = (text: string): string => {
    const walk = (value: unknown): unknown => {
      if (typeof value === 'string') return reference(value);
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
      return value;
    };
    const value = JSON.parse(text);
    const next = walk(value);
    return JSON.stringify(value) === JSON.stringify(next) ? text : JSON.stringify(next);
  };
  const tables = [
    { table: 'events', entity: 'event', fields: { content: markdown, media_json: json } },
    { table: 'event_messages', entity: 'event_message', fields: { body: markdown } },
    { table: 'persons', entity: 'person', fields: { avatar: reference, icon_json: json, notes: markdown } },
    { table: 'collections', entity: 'collection', fields: { cover: reference, icon_json: json, description: markdown } },
    { table: 'memoirs', entity: 'memoir', fields: { cover_file_id: reference, pages_json: json } },
  ];
  transact(() => {
    // 先全部搬到临时名，避免目标仍被同组旧记录占用（唯一索引）。
    for (const p of plan) run('UPDATE attachments SET stored_id = ? WHERE id = ?', [`compact-${crypto.randomUUID()}`, p.id]);
    for (const p of plan) {
      run('UPDATE attachments SET stored_id = ? WHERE id = ?', [p.to, p.id]);
      appendOplog('attachment', p.id, 'update', { storedId: p.to });
    }
    for (const { table, entity, fields } of tables) {
      const transforms = Object.entries(fields) as [string, (text: string) => string][];
      // 包括回收站记录，恢复后引用仍需有效。
      for (const row of queryAll<Record<string, string | null>>(`SELECT id, ${transforms.map(([key]) => key).join(',')} FROM ${table}`)) {
        const changed = transforms.flatMap(([key, transform]) => {
          if (row[key] === null) return [];
          const next = transform(row[key]!);
          return next === row[key] ? [] : [{ key, next }];
        });
        if (!changed.length) continue;
        run(`UPDATE ${table} SET ${changed.map(({ key }) => `${key} = ?`).join(',')}, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?`,
          [...changed.map(c => c.next), hlcNow(getDeviceId()), new Date().toISOString(), row.id]);
        appendOplog(entity, row.id!, 'update', { reason: 'compact-file-names' });
      }
    }
  });
  return plan.length;
}
