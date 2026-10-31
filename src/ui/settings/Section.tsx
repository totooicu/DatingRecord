// 设置页通用卡片外壳 + 时间格式化
//
// 卡片骨架本身在 common/Card.tsx（详情面板和统计小卡也用它），
// 这里只保留设置页的语义：desc 走 guide-only，专注模式下自动收起。

import { Card } from '../common/Card';

export function Section({
  title,
  desc,
  extra,
  children,
}: {
  /** 子页标题可省：head 已经写了本页名字时，再来一行就是重复占位 */
  title?: string;
  desc?: string;
  /** 标题右侧的徽标 / 按钮：以前好几张卡为了放它又手写了一遍 card-head */
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card title={title} desc={desc} extra={extra}>
      {children}
    </Card>
  );
}

export function fmtMeta(iso: string | null): string {
  if (!iso) return '从未';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
