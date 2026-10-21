// 构建时间：由 vite.config.ts 在每次 build 时注入，方便线上验证是否最新。
declare const __BUILD_TIME__: string;
export const BUILD_TIME: string = __BUILD_TIME__;

export function fmtBuildTime(): string {
  try {
    const d = new Date(BUILD_TIME);
    if (Number.isNaN(d.getTime())) return BUILD_TIME;
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return BUILD_TIME;
  }
}
