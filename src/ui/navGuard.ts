// 全局「正在忙，先别撵我走」登记处。
//
// 场景：AI 正在多轮调工具，用户手滑点了底部 Tab、设置返回键，或者直接刷新——
// 这一轮就白跑了，会话还留在组件 state 里，刷新更是连记录都不剩。
// 所以「忙」的页面在这里登记一个守卫；所有导航入口（底部 Tab、顶部导航、
// 设置子页切换/返回）统一先问一句 canLeave()，不让走就飘个原因。
//
// 为什么不做成路由中间件：这个应用没有路由库，view 就是几个 useState，
// 与其引入一套机制，不如把仅有的几个导航入口拦住。

import { showToast } from './toast';

/** 返回非 null 就是要拦，字符串是给用户看的原因 */
type Guard = () => string | null;

let guard: Guard | null = null;

/** 登记守卫；传 null 注销。同一时刻只有一个页面能忙 */
export function setNavGuard(g: Guard | null): void {
  guard = g;
}

/**
 * 问一句「现在能走吗」。不能走就飘原因、返回 false——
 * 调用方（导航入口）直接 return，不切页面。
 */
export function canLeave(): boolean {
  const why = guard?.();
  if (why) {
    showToast(why, 2400);
    return false;
  }
  return true;
}

/**
 * 系统返回键（popstate）拦截器。
 *
 * 返回 true = 我已经在应用内后退了一层，App 要 pushState 把历史钉回当前页；
 * 返回 false = 我没处理，让浏览器真的退（即退出网页）。
 *
 * 同一时刻只有一个页面登记，一般是设置页在管自己的「目录 / 子页」两级。
 */
type BackHandler = () => boolean;

let backHandler: BackHandler | null = null;

export function setBackHandler(h: BackHandler | null): void {
  backHandler = h;
}

export function runBackHandler(): boolean {
  return backHandler?.() ?? false;
}
