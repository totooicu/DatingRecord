// 通用分页：把一维数组切成「当前页」子数组，并维护页码边界。
//
// 只管切片与翻页，不碰筛选/排序——那些在调用方算好后再传进来。
// 数据变少导致当前页越界时（比如删完最后一页），自动收回到有效页。
// 每页条数不在这里存：它是设备偏好（prefs.getPageSize），由调用方传进来，
// 这样所有列表共用一个数，在任一分页控件里改一次，别处同帧跟上。
import { useEffect, useMemo, useState } from 'react';

export interface Paged<T> {
  page: number;
  /** 翻到第 n 页（会被夹紧到 [1, totalPages]） */
  setPage: (n: number) => void;
  /** 首/末页与上下页：分页控件只调这四个，不再自己算页码 */
  first: () => void;
  prev: () => void;
  next: () => void;
  last: () => void;
  canPrev: boolean;
  canNext: boolean;
  /** 当前页要渲染的那一段 */
  pageItems: T[];
  totalPages: number;
  /** 当前页第一条/最后一条的序号（1-based），用于「第 from-to 条」 */
  from: number;
  to: number;
  /** 这一页最多能放几条（= 调用方传进来的 pageSize） */
  pageSize: number;
}

export function usePaged<T>(items: T[], pageSize: number): Paged<T> {
  const [page, setPageRaw] = useState(1);
  const size = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / size));

  // 数据缩减后页码可能越界，收回到最后一页（删光最后一页时靠谱）
  useEffect(() => {
    if (page > totalPages) setPageRaw(totalPages);
  }, [page, totalPages]);

  const start = (page - 1) * size;
  const pageItems = useMemo(() => items.slice(start, start + size), [items, start, size]);
  const from = items.length === 0 ? 0 : start + 1;
  const to = Math.min(start + size, items.length);

  const setPage = (n: number) => setPageRaw(Math.min(Math.max(1, n), totalPages));

  return {
    page,
    setPage,
    first: () => setPage(1),
    prev: () => setPage(page - 1),
    next: () => setPage(page + 1),
    last: () => setPage(totalPages),
    canPrev: page > 1,
    canNext: page < totalPages,
    pageItems,
    totalPages,
    from,
    to,
    pageSize: size,
  };
}
