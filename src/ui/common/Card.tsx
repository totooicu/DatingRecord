// 卡片：设置页的分区卡、详情面板的区块卡、概览里的统计小卡，全都是这一颗。
//
// 以前是三套骨架各写各的：
//   设置页 —— Section（section.card + card-head + 说明文字）
//   详情页 —— 人物/事件集详情里手写的 section.card（有的带右侧控件，有的把整个 head 做成按钮）
//   统计   —— div.stat-card（数字 + 标签，跟前两者压根不是一个结构）
// 结果同一个「卡片」在十几个文件里长着十几种细节，改个圆角要搜三遍。
//
// 现在靠 variant 选型：
//   section（默认）—— 标题 + 说明 + 内容，支持右侧插槽与完全自定义 head；
//   stat           —— 数字 + 标签的小格，外层 .stat-row 由调用方自己摆。

import type { ReactNode } from 'react';

export type CardVariant = 'section' | 'stat';

export function Card({
  variant = 'section',
  title,
  desc,
  extra,
  head,
  num,
  label,
  hint,
  className,
  headClassName,
  children,
}: {
  variant?: CardVariant;
  /** 标准标题：自动生成 card-head + card-title */
  title?: ReactNode;
  /** 标题下的说明文字：专注模式下自动隐藏（guide-only） */
  desc?: ReactNode;
  /** 头部右侧插槽：视图切换、按钮组这类 */
  extra?: ReactNode;
  /** 完全自定义头部（整个 head 要做成按钮时用），给了它就忽略 title/extra */
  head?: ReactNode;
  /** stat 变体的数字 */
  num?: ReactNode;
  /** stat 变体的标签 */
  label?: ReactNode;
  /** stat 变体：数字的悬浮提示（如「含所有子事件集」） */
  hint?: string;
  /** 追加在 section 上的类名 */
  className?: string;
  /** 追加在 card-head 上的类名（如事件卡要收紧标题下间距的 event-card-head） */
  headClassName?: string;
  children?: ReactNode;
}) {
  if (variant === 'stat') {
    return (
      <div className={className ? `stat-card ${className}` : 'stat-card'}>
        <span className="stat-num" title={hint}>
          {num}
        </span>
        <span className="stat-label">{label}</span>
      </div>
    );
  }
  const headCls = ['card-head', headClassName ?? ''].filter(Boolean).join(' ');
  return (
    <section className={className ? `card ${className}` : 'card'}>
      {head ??
        ((title || extra) && (
          <div className={headCls}>
            {title && <h4 className="card-title">{title}</h4>}
            {extra}
          </div>
        ))}
      {desc && <p className="muted guide-only">{desc}</p>}
      {children}
    </section>
  );
}
