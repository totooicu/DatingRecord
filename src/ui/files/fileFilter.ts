// 文件列表的筛选与排序：纯函数，方便单独推理和复用。
import type { StoredFile } from '../../core/repo/files';
import { kindOf, type PreviewKind } from '../preview';

export type FileSortKey = 'time' | 'name' | 'size' | 'refs';
export type FileSortDir = 'asc' | 'desc';
/** 引用筛选：任一 / 未被引用 / 有引用（事件、头像、图标都算） */
export type FileRefFilter = 'any' | 'none' | 'some';

export interface FileSort {
  key: FileSortKey;
  dir: FileSortDir;
}

export const DEFAULT_SORT: FileSort = { key: 'time', dir: 'desc' };

export interface FileFilter {
  q: string;
  types: PreviewKind[];
  refs: FileRefFilter;
  /** YYYY-MM-DD，含当天 */
  from: string;
  to: string;
  /** KB，空字符串表示不限 */
  minKB: string;
  maxKB: string;
}

export const EMPTY_FILTER: FileFilter = {
  q: '',
  types: [],
  refs: 'any',
  from: '',
  to: '',
  minKB: '',
  maxKB: '',
};

/** 目录筛选条件的数量（搜索词不计入，避免「有筛选」徽标被搜索一直点亮） */
export function activeFilterCount(f: FileFilter): number {
  return (
    f.types.length +
    (f.refs !== 'any' ? 1 : 0) +
    (f.from ? 1 : 0) +
    (f.to ? 1 : 0) +
    (f.minKB ? 1 : 0) +
    (f.maxKB ? 1 : 0)
  );
}

/** 本地日期，避免 UTC 与用户看到的日期差一天 */
function localDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function kb(value: string): number | null {
  const s = value.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * 搜索词命中哪些字段：实际名、引用名（`sha-…` / `link-…`）、sha256 全文。
 *
 * 三个都要：用户手里的线索可能是文件名（截图时随手起的）、文件页上那行引用名，
 * 或者从别处复制来的完整 hash（排查「这两张图是不是同一份」时最常干这个）。
 * hash 一律十六进制、大小写无关，所以统一转小写再比。
 */
function hitQuery(file: StoredFile, q: string): boolean {
  return (
    file.name.toLowerCase().includes(q) ||
    file.storedId.toLowerCase().includes(q) ||
    file.sha256.toLowerCase().includes(q)
  );
}

export function applyFilter(
  files: StoredFile[],
  f: FileFilter,
  sort: FileSort,
  refCounts: Record<string, number>,
): StoredFile[] {
  const q = f.q.trim().toLowerCase();
  const min = kb(f.minKB);
  const max = kb(f.maxKB);

  const out = files.filter((file) => {
    if (q && !hitQuery(file, q)) return false;

    if (f.types.length && !f.types.includes(kindOf(file.name, file.mime))) return false;

    const day = localDate(file.createdAt);
    if (f.from && day && day < f.from) return false;
    if (f.to && day && day > f.to) return false;

    if (min !== null && file.size < min * 1024) return false;
    if (max !== null && file.size > max * 1024) return false;

    // refCounts 是「事件 + 头像 + 图标」的总引用数，和行尾「未被引用」同源
    const total = refCounts[file.id] ?? 0;
    if (f.refs === 'none' && total !== 0) return false;
    if (f.refs === 'some' && total === 0) return false;

    return true;
  });

  const sign = sort.dir === 'asc' ? 1 : -1;
  // 同值时统一按上传时间新到旧兜底，来回切换排序时列表不会抖
  const tie = (a: StoredFile, b: StoredFile) => b.createdAt.localeCompare(a.createdAt);
  switch (sort.key) {
    case 'name':
      out.sort(
        (a, b) =>
          sign * a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }) || tie(a, b),
      );
      break;
    case 'size':
      out.sort((a, b) => sign * (a.size - b.size) || tie(a, b));
      break;
    case 'refs':
      out.sort(
        (a, b) => sign * ((refCounts[a.id] ?? 0) - (refCounts[b.id] ?? 0)) || tie(a, b),
      );
      break;
    default:
      out.sort((a, b) => sign * a.createdAt.localeCompare(b.createdAt) || tie(a, b));
  }

  return out;
}
