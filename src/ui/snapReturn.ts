// 从成果详情跳到某个对象（人 / 事 / 事集）之后，怎么回来。
//
// 成果详情是个弹窗，里面点「P1」会切到人物详情页——弹窗所在的设置页随之卸载，
// 用户看完想回来接着「接受 / 拒绝」，却只能重新走一遍
// 设置 → AI → AI 对话 → 成果 → 点开。很多人走到一半就放弃了。
//
// 所以跳转前把「我是从哪份成果来的」记在这里（只在内存里，刷新即失效）：
//   1. 详情页按返回键 → App 的 backToList 看到有 pending，直接回设置页；
//   2. 设置页初始化时看到有 pending，直接落在「AI 对话」子页；
//   3. AI 对话页挂载时把它取走，切到「成果」并重新打开那份成果详情。
// 三步连起来就是：点进去看一眼，按返回，原样回到那份成果。

let pending: string | null = null;

/** 记住来路：从这份成果跳出去看对象了 */
export function setSnapReturn(snapId: string): void {
  pending = snapId;
}

/** 只看一眼，不消费（设置页初始化、返回键判断用） */
export function peekSnapReturn(): string | null {
  return pending;
}

/** 取走：AI 对话页用它重开成果详情，取走之后就不再重复弹 */
export function takeSnapReturn(): string | null {
  const p = pending;
  pending = null;
  return p;
}

/** 用户自己关掉成果详情 / 点了接受或放弃：回程就此结束 */
export function clearSnapReturn(): void {
  pending = null;
}
