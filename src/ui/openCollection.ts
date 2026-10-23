// 「打开某个事件集」的全局通道，与 openPerson / openEvent 对称。
//
// 触发点在设置页的 AI 成果详情弹窗里，离 App 的组件树很远；
// 保留一个可变回调，由 App 挂载时注册，没注册时调用是安全的空操作。
type Handler = (collectionId: string) => void;

let handler: Handler | null = null;

export function setCollectionOpener(fn: Handler | null): void {
  handler = fn;
}

/** 切到事件集并打开该事件集的详情 */
export function openCollection(collectionId: string): void {
  handler?.(collectionId);
}

export function canOpenCollection(): boolean {
  return handler !== null;
}
