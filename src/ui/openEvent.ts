// 「打开某条事件」的全局通道。
//
// 为什么不用 context：触发它的地方散落在设置页的文件库、文件预览等弹窗里，
// 这些组件离 App 的组件树很远，逐层透传 onOpenEvent 会污染一路的 props。
// 这里保留一个可变回调，由 App 挂载时注册；没有注册时调用是安全的空操作。

type Handler = (eventId: string) => void;

let handler: Handler | null = null;

export function setEventOpener(fn: Handler | null): void {
  handler = fn;
}

/** 切到时间线并打开该事件的编辑框 */
export function openEvent(eventId: string): void {
  handler?.(eventId);
}

export function canOpenEvent(): boolean {
  return handler !== null;
}
