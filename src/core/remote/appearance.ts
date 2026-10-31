// 外观（主题色 / 底色 / 深浅）跨设备跟随。
//
// 主题本身仍是「这台设备看着顺眼」的偏好，存在 localStorage、不进库也不进备份。
// 但当一台设备在用另一台的数据时，配色不一致会显得像两个软件——所以服务端
// 把当前外观当成一次性的展示参数随连接发过去，客户端照着调色，**不写自己的存档**：
// 断开后刷新回本地，还是它自己选的那套颜色。
//
// 这里只放「谁提供 / 谁来贴」的插槽，具体 paint 在 ui/theme.ts。
// 路由器是 core，不能反过来 import ui，所以用注册的方式接起来。

import type { RemoteAppearance } from './types';

let provider: (() => RemoteAppearance | null) | null = null;
let applier: ((a: RemoteAppearance) => void) | null = null;

export function setAppearanceBridge(
  get: () => RemoteAppearance | null,
  apply: (a: RemoteAppearance) => void,
): void {
  provider = get;
  applier = apply;
}

/** 服务端当前外观；桥没接上（例如非 UI 环境）返回 null，协议里就不带这条消息 */
export function hostAppearance(): RemoteAppearance | null {
  try {
    return provider?.() ?? null;
  } catch {
    return null;
  }
}

/** 校验对端发来的外观：不合法就整条丢弃，别把页面刷成空白 */
export function normalizeAppearance(v: unknown): RemoteAppearance | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Partial<RemoteAppearance>;
  const accent = typeof a.accent === 'string' && /^#[0-9a-f]{6}$/i.test(a.accent) ? a.accent.toLowerCase() : null;
  const base = typeof a.base === 'string' && a.base.length > 0 && a.base.length <= 24 ? a.base : null;
  const mode = a.mode === 'dark' ? 'dark' : a.mode === 'light' ? 'light' : null;
  if (!accent || !base || !mode) return null;
  return { accent, base, mode };
}

export function applyRemoteAppearance(v: unknown): void {
  const a = normalizeAppearance(v);
  if (!a || !applier) return;
  try {
    applier(a);
  } catch {
    /* 配色失败不能影响数据的主流程 */
  }
}
