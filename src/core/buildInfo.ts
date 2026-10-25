// 构建时间与产品版本：都由 vite.config.ts 在每次 build 时注入。
// 版本号是壳与网页配对的依据（见 src/core/compat/pairing.ts），别手改字面量。
declare const __BUILD_TIME__: string;
declare const __APP_VERSION__: string;
export const BUILD_TIME: string = __BUILD_TIME__;
export const APP_VERSION: string = __APP_VERSION__;

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
