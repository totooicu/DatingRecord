// 全局导航路由：让 head 上的状态图标、服务/任务页都能在不直接持有 App state
// 的情况下切换页面（仿 src/ui 里 setEventOpener 那一族全局回调）。
//
// App 在挂载时 setNavHandler 注册真实实现（把目标翻译成 view / settings sub）；
// 任何组件想跳转就调 navigate(...)。

import type { NavTarget } from './store';

type Handler = (t: NavTarget) => void;

let handler: Handler | null = null;

/** App 注册导航实现；传 null 注销（卸载时） */
export function setNavHandler(fn: Handler | null): void {
  handler = fn;
}

/** 跳转到某个目标；没注册处理器时静默失败 */
export function navigate(t: NavTarget): void {
  handler?.(t);
}
