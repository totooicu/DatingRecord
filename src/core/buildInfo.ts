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

/**
 * 统一成「2026-10-25 18:32」，给「壳:… | 网:…」这种并排比较用。
 *
 * 两边的来源格式不同：网页的 BUILD_TIME 是构建时的 ISO（UTC，带 Z），
 * 壳的 builtAt 是写死的 Asia/Shanghai 本地时间（`YYYY-MM-DD HH:mm`）。
 * 所以带时区的交给 Date 按设备时区折算；不带时区的原样返回——再折一次
 * 反而会把壳的时间按设备时区平移，跟开发者写死的那个数对不上。
 *
 * 传了 timeZone 就按该时区折算（网页这边传 'Asia/Shanghai'：壳的时间固定在上海时区，
 * 不统一的话人在国外看这一行，两个时间根本没法比）。
 */
export function fmtTime(value: string, timeZone?: string): string {
  const s = (value || '').trim();
  if (!s) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  if (m && !hasTz) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const at = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
    return `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')}`;
  }
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
