// 「打开某个人物」的全局通道，与 openEvent 对称。
//
// 用途：文件库里看到「这张图是某某的头像」，点一下就跳到那个人。
// 触发点在设置页的弹窗里，离 App 的组件树很远，逐层透传会污染一路 props。
type Handler = (personId: string) => void;

let handler: Handler | null = null;

export function setPersonOpener(fn: Handler | null): void {
  handler = fn;
}

/** 切到人物列表并打开该人物的详情 */
export function openPerson(personId: string): void {
  handler?.(personId);
}

export function canOpenPerson(): boolean {
  return handler !== null;
}
