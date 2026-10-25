// 返回键：安卓壳把系统返回转成 ui.backPressed，页面决定退到哪。
//
// 壳的实现（geckoview_example 的 WebViewActivity.onBackKey）：
//   · 页面加载完才转发，data.atRoot 只说明 WebView 的历史栈在不在根上——
//     它是单页应用，路由在 view 状态里，壳看不见；
//   · 页面 3 秒内不回应就按 canGoBack ? goBack : finish 兜底；
//   · ui.goBack / ui.finish 都会取消这 3 秒兜底。
//
// 所以这里的约定是：
//   · 页面自己退了一层（关弹窗 / 详情回列表 / 设置子页回父级）→ ui.goBack 回执。
//     我们的 SPA 从不写 history，WebView.canGoBack() 一直是 false，这个回执
//     只是告诉壳「别兜底了」，不会再多退一格；
//   · 已经退无可退 → ui.finish，由壳退出应用（而不是留在原地等 3 秒）。
//
// 浮层（弹窗、全屏编辑）后进先出：最后打开的先用返回键关掉。

import { invoke, onBridgeEvent } from '../core/compat/bridge';

type BackFn = () => void;

const layers: BackFn[] = [];

/** 登记一个「按返回先关我」的浮层；返回注销函数。后登记的在上层 */
export function pushBackLayer(fn: BackFn): () => void {
  layers.push(fn);
  return () => {
    const i = layers.lastIndexOf(fn);
    if (i >= 0) layers.splice(i, 1);
  };
}

/** 关掉最上层浮层；没有浮层返回 false */
export function closeTopLayer(): boolean {
  const top = layers[layers.length - 1];
  if (!top) return false;
  // 先从栈里摘掉再关：onClose 里如果又弹了别的窗，顺序才不会乱
  layers.pop();
  try {
    top();
  } catch {
    /* 关不动就当没这层，别把返回键卡死 */
  }
  return true;
}

/** 页面已经把这一下返回用掉了：让壳取消它的 3 秒兜底 */
export function ackBackHandled(): void {
  void invoke('ui.goBack', {}, 3000).catch(() => {
    /* 老壳没有 ui.*：没有兜底，也就无所谓回执 */
  });
}

/** 退无可退：让壳退出应用 */
export function askShellFinish(): void {
  void invoke('ui.finish', {}, 3000).catch(() => {
    /* 老壳没接 ui.* 时只能靠它自己的默认行为 */
  });
}

/** 订阅壳的返回键；返回取消订阅。普通浏览器里永远不会触发 */
export function onShellBackPressed(cb: () => void): () => void {
  return onBridgeEvent('ui.backPressed', () => cb());
}
