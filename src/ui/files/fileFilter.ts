// 文件列表的筛选与排序：纯函数，方便单独推理和复用。
import type { StoredFile } from '../../core/repo/files';
import { kindOf, type PreviewKind } from '../preview';

export type FileSort =
  | 'new'
  | 'old'
  | 'name'
  | 'size-desc'
  | 'size-asc'
  | 'refs-desc'
  | 'refs-asc';

export interface FileFilter {
  q: string;
  types: PreviewKind[];
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
  from: '',
  to: '',
  minKB: '',
  maxKB: '',
};

/** 目录筛选条件的数量（搜索词不计入，避免「有筛选」徽标被搜索一直点亮） */
export function activeFilterCount(f: FileFilter): number {
  return f.types.length + (f.from ? 1 : 0) + (f.to ? 1 : 0) + (f.minKB ? 1 : 0) + (f.maxKB ? 1 : 0);
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
    if (q && !file.name.toLowerCase().includes(q)) return false;

    if (f.types.length && !f.types.includes(kindOf(file.name, file.mime))) return false;

    const day = localDate(file.createdAt);
    if (f.from && day && day < f.from) return false;
    if (f.to && day && day > f.to) return false;

    if (min !== null && file.size < min * 1024) return false;
    if (max !== null && file.size > max * 1024) return false;

    return true;
  });

  switch (sort) {
    case 'old':
      out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    case 'name':
      out.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }));
      break;
    case 'size-desc':
      out.sort((a, b) => b.size - a.size);
      break;
    case 'size-asc':
      out.sort((a, b) => a.size - b.size);
      break;
    case 'refs-desc':
      // 引用数相同的按上传时间新到旧，列表不会因为排序来回抖
      out.sort(
        (a, b) =>
          (refCounts[b.id] ?? 0) - (refCounts[a.id] ?? 0) || b.createdAt.localeCompare(a.createdAt),
      );
      break;
    case 'refs-asc':
      out.sort(
        (a, b) =>
          (refCounts[a.id] ?? 0) - (refCounts[b.id] ?? 0) || b.createdAt.localeCompare(a.createdAt),
      );
      break;
    default:
      out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return out;
}
