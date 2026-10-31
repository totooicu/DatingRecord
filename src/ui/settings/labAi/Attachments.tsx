// 附件：输入区左边的两个入口图标 + 附件卡片与清单。
// 只管长相，发什么由 core/ai/attach.ts 决定。

import { fmtSize, previewOf, type Attachment } from '../../../core/ai/attach';
import { ICON } from './model';

export function AttachIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M20 11.4l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.4-8.4a3.4 3.4 0 0 1 4.8 4.8l-8.3 8.3a1.8 1.8 0 0 1-2.6-2.6l7.6-7.6" />
    </svg>
  );
}

export function LibIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M3.6 7.4h6l1.8 2.2h8.9v9.2a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6z" />
      <path d="M3.6 7.4V5.2a1.6 1.6 0 0 1 1.6-1.6h3.6l1.6 2" />
    </svg>
  );
}

/**
 * 附件卡片的缩略图。
 *
 * 三类：真图片直接缩略；文本露几行正文；读不了的（pdf/zip…）把后缀放大显示。
 * 纯展示，不参与发送。
 */
function AttThumb({ att }: { att: Attachment }) {
  const p = previewOf(att);
  if (p.type === 'image') {
    return <img className="aichat-att-img" src={p.src} alt="" loading="lazy" />;
  }
  if (p.type === 'text') {
    return <span className="aichat-att-text">{p.snippet}</span>;
  }
  return <span className="aichat-att-ext">{p.ext}</span>;
}

/** 附件清单：一张张卡片，横向排不开就换行 */
export function AttachmentChips({
  atts,
  onRemove,
}: {
  atts: Attachment[];
  onRemove?: (key: string) => void;
}) {
  return (
    <ul className="aichat-atts">
      {atts.map((a) => (
        <li key={a.key} className={a.warning ? 'aichat-att aichat-att-warn' : 'aichat-att'}>
          <span className="aichat-att-thumb" aria-hidden>
            <AttThumb att={a} />
          </span>
          <span className="aichat-att-meta">
            <span className="aichat-att-name" title={`${a.name}（${fmtSize(a.size)}）`}>
              {a.name}
            </span>
            <span className="aichat-att-size">{fmtSize(a.size)}</span>
          </span>
          {a.warning && (
            <span className="aichat-att-warn-text" title={a.warning}>
              {a.warning}
            </span>
          )}
          {onRemove && (
            <button className="aichat-att-x" onClick={() => onRemove(a.key)} aria-label={`移除 ${a.name}`}>
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
