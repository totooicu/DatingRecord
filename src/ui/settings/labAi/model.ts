// AI 对话页的纯数据层：常量、映射表、两个「说人话」的归纳函数。
// 不碰 React 状态，tab 视图与弹窗都能直接引。

import { summarizeOps, type SnapDiffItem, type SnapMeta } from '../../../core/snapshots';

export type TabKey = 'chat' | 'history' | 'snap' | 'help';

/** 空对话时的三条引导语：点一下直接发出去 */
export const QUICK = [
  '这个库里都有什么？',
  '最近发生了哪些事？',
  '把这份文件里的内容整理成一条事件',
];

/** 输入区左边的小图标：内联 SVG 而不是 emoji，部分安卓机会把 📎 渲染成方框 */
export const ICON = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** 快照来源的人话标签 */
export const SNAP_SRC: Record<SnapMeta['source'], string> = {
  manual: '手动',
  ai: 'AI',
  cli: 'CLI',
  auto: '自动',
};

export const DIFF_KIND: Record<SnapDiffItem['kind'], string> = {
  person: '人物',
  event: '事件',
  collection: '事件集',
};

/**
 * 快照列表的主标题：概括这份快照对应的那次操作。
 *
 * 有 ops（AI 轮次结束回写的）就用人话概括，比如「新建人物「林小满」、记 2 条事件」；
 * 没有就退到备注，再没有就按来源说「AI 自动备份」。扫一眼就知道每份快照是干什么的，
 * 不用点开猜。
 */
export function snapTitle(s: SnapMeta): string {
  // 用户想看的是「这轮是为了什么」：AI 轮次结束后把第一条用户指令回写成 note，
  // 比如「把这批聊天记录整理进去」，比罗列九个工具调用更像人话。
  if (s.note) return s.note;
  // 没有意图（CLI 触发、手动备份）才退回按操作概括
  if (s.ops?.length) return summarizeOps(s.ops);
  return `${SNAP_SRC[s.source] ?? ''}备份`.replace(/^备份$/, '记录');
}

/** 这条记录在成果里属于新增 / 修改 / 删除哪一组 */
export function actionOf(
  snap: SnapMeta,
  item: SnapDiffItem,
): 'created' | 'updated' | 'deleted' {
  const d = snap.diff;
  if (d?.deleted.some((r) => r.id === item.id && r.kind === item.kind)) return 'deleted';
  if (d?.updated.some((r) => r.id === item.id && r.kind === item.kind)) return 'updated';
  return 'created';
}
