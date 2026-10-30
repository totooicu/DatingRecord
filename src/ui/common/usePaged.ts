// 通用分页：把一维数组切成「当前页」子数组，并维护页码边界。
//
// 只管切片与翻页，不碰筛选/排序——那些在调用方算好后再传进来。
// 数据变少导致当前页越界时（比如删完最后一页），自动收回到有效页。
import { useEffect, useMemo, useState } from 'react';

export interface Paged<T> {
  page: number;
  /** 翻到第 n 页（会被夹紧到 [1, totalPages]） */
  setPage: (n: number) => void;
  /** 当前页要渲染的那一段 */
  pageItems: T[];
  totalPages: number;
  /** 当前页第一条/最后一条的序号（1-based），用于「第 from-to 条」 */
  from: number;
  to: number;
  total: number;
}

export function usePaged<T>(items: T[], pageSize: number): Paged<T> {
  const [page, setPageRaw] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  // 数据缩减后页码可能越界，收回到最后一页（删光最后一页时靠谱）
  useEffect(() => {
    if (page > totalPages) setPageRaw(totalPages);
  }, [page, totalPages]);

  const start = (page - 1) * pageSize;
  const pageItems = useMemo(() => items.slice(start, start + pageSize), [items, start, pageSize]);
  const from = items.length === 0 ? 0 : start + 1;
  const to = Math.min(start + pageSize, items.length);

  const setPage = (n: number) => setPageRaw(Math.min(Math.max(1, n), totalPages));

  return { page, setPage, pageItems, totalPages, from, to, total: items.length };
}
