// 分页控件：所有长列表共用这一颗。人物 / 事件集 / 时间线 / 文件 / 集合成员都是它。
//
// 为什么不用「上一页 / 下一页」这种文字按钮：手机上这一行只有 390px 宽，
// 四个文字按钮就把「跳到第几页」挤没了（实测「下一页」一颗就占 72px）。
// 所以导航一律用箭头图标，文字只留在 aria-label / title 里——
// 读屏软件照样念得出「下一页」，e2e 也照样能按可访问名点它。
//
// 一行放得下的东西：首页、上一页、跳到第几页（可直接编辑）、总页数、
// 下一页、尾页、当前区间、每页条数（设备级偏好，改一次所有列表同时变）。
//
// 位置由 CSS 负责：列表栏（.pane-list）里它钉在底部导航栏上方，见 styles/list.css
// 的「分页」段；卡片 / 弹窗里就是普通一行。
import { useEffect, useRef, useState } from 'react';
import type { Paged } from './usePaged';
import { PAGE_SIZES, setPageSize } from '../prefs';

/** 单个 / 双个尖角：‹ › « »。用 SVG 而不是字符，免得安卓字库里尖角粗细不一、还容易被当成 emoji。
 *  导出给「不是标准分页、但同样要左右箭头」的地方用（定位预览的点位窗口），
 *  免得同一支箭头在两个文件里画两遍、粗细对不上。 */
export function Chev({ dir, double }: { dir: 'l' | 'r'; double?: boolean }) {
  const flip = dir === 'r';
  return (
    <svg viewBox="0 0 16 16" className="pager-ico" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points={flip ? '6,3 11,8 6,13' : '10,3 5,8 10,13'} />
        {double && <polyline points={flip ? '2,3 7,8 2,13' : '14,3 9,8 14,13'} />}
      </g>
    </svg>
  );
}

/**
 * 翻页后把真正在滚的那个容器拉回顶部。
 * 分页条钉在列表底部，用户点「下一页」时scrollTop 还停在上一页末尾，
 * 新页只露出最后几行，看着像没翻页。往上找第一个装得下滚动条的祖先
 * （列表是 .pane，弹窗是 .modal-body，卡片可能是外层那个），不用调用方传引用。
 */
function scrollTopFrom(el: HTMLElement | null) {
  let n: HTMLElement | null = el?.parentElement ?? null;
  while (n && n !== document.body) {
    if (n.scrollHeight > n.clientHeight + 1) {
      n.scrollTo({ top: 0 });
      return;
    }
    n = n.parentElement;
  }
}

export function Paginator<T>({ paged }: { paged: Paged<T> }) {
  const { page, totalPages, pageSize, from, to } = paged;
  // 输入框里是「草稿」：正在敲 1 想敲 12 时不该一路被当成 1 页跳走
  const [draft, setDraft] = useState(String(page));
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(String(page)), [page]);

  // 一页就装完（含空列表）→ 整条不出现。
  // 分页控件只在「真有第二页可去」时才有意义；常驻一行区间 + 每页条数，
  // 只会让只有几条数据的卡片、归档面板看起来像坏了一半。
  // 每页条数照样能在任意长列表上调，调完这一处也跟着变（它是设备偏好）。
  if (totalPages <= 1) return null;

  const after = (nav: () => void) => {
    nav();
    scrollTopFrom(root.current);
  };
  const commit = () => {
    const n = parseInt(draft, 10);
    if (Number.isNaN(n)) setDraft(String(page));
    else after(() => paged.setPage(n));
  };

  const btn = (label: string, onClick: () => void, disabled: boolean, icon: JSX.Element) => (
    <button type="button" className="pager-btn" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {icon}
    </button>
  );

  // 区间：一页就能装完时它其实是「一共多少条」的替代说法，所以窄屏只藏多页那一档
  const range = (
    <span className="pager-range" title="当前页覆盖的条目序号">
      {from}-{to}
    </span>
  );

  return (
    <div className="pager" role="group" aria-label="分页" ref={root}>
      {btn('首页', () => after(paged.first), !paged.canPrev, <Chev dir="l" double />)}
      {btn('上一页', () => after(paged.prev), !paged.canPrev, <Chev dir="l" />)}
      <span className="pager-page">
        <input
          className="pager-jump"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label="跳转到指定页"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') setDraft(String(page));
          }}
        />
        <span className="pager-of">/{totalPages}</span>
      </span>
      {btn('下一页', () => after(paged.next), !paged.canNext, <Chev dir="r" />)}
      {btn('末页', () => after(paged.last), !paged.canNext, <Chev dir="r" double />)}
      {range}
      <SizeSelect value={pageSize} />
    </div>
  );
}

/** 每页条数：写进设备偏好，所有分页列表同时跟着变 */
function SizeSelect({ value }: { value: number }) {
  return (
    <select
      className="pager-size"
      aria-label="每页条数"
      title="每页条数"
      value={value}
      onChange={(e) => setPageSize(Number(e.target.value))}
    >
      {PAGE_SIZES.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}
