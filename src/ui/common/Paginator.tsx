// 翻页控件：上一页 / 第 X / Y 页 / 下一页。
//
// 只有一页时不渲染（但总数 > 0 时给个「共 N 条」的小字，免得用户以为没加载完）。
// 调用方把 usePaged 返回的内容直接传进来即可。
import type { Paged } from './usePaged';

export function Paginator<T>({
  paged,
  onPage,
}: {
  paged: Paged<T>;
  onPage: (n: number) => void;
}) {
  const { page, totalPages, from, to, total } = paged;
  if (totalPages <= 1) {
    return total > 0 ? <div className="pager pager-single muted small">共 {total} 条</div> : null;
  }
  return (
    <div className="pager">
      <button
        type="button"
        className="pager-btn"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        上一页
      </button>
      <span className="pager-info">
        第 {page} / {totalPages} 页 · {from}-{to} / {total}
      </span>
      <button
        type="button"
        className="pager-btn"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        下一页
      </button>
    </div>
  );
}
