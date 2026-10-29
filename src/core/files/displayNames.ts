import { queryAll } from '../db';
import { extOf } from './naming';

// 全库占名，不受隐私显示过滤影响；使用 JS trim，兼容旧库的首尾空白。
export function availableFileName(input: string, exceptId?: string): string {
  const name = input.trim() || '未命名';
  const used = new Set(queryAll<{ id: string; name: string }>('SELECT id, name FROM attachments')
    .filter((f) => f.id !== exceptId).map((f) => f.name.trim()));
  if (!used.has(name)) return name;
  const ext = extOf(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  // 已编号的名称继续编号，不产生 a_2_2.jpg。
  const match = /^(.*)_([2-9]\d*|1\d+)$/.exec(stem);
  const base = match?.[1] || stem;
  let index = match ? BigInt(match[2]) + 1n : 2n;
  while (used.has(`${base}_${index}${ext}`)) index++;
  return `${base}_${index}${ext}`;
}

export class FileNameConflict extends Error {
  constructor(public suggestion: string) {
    super(`名称已被占用，可改为「${suggestion}」`);
    this.name = 'FileNameConflict';
  }
}

export function assertFileNameAvailable(input: string, id: string): string {
  const name = input.trim();
  if (!name) throw new Error('文件名不能为空');
  const suggestion = availableFileName(name, id);
  if (suggestion !== name) throw new FileNameConflict(suggestion);
  return name;
}
