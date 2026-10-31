// 定位面板的「纯数据层」：类型、常量、不碰 React 也不碰 Leaflet 的小函数。
//
// 从 LocationPanel.tsx 里分出来：那一段本来有 178 行，全是画地图要用的色号、半径、
// 档位表和几个格式化函数，跟交互一点关系没有。把它们挪走之后，
// 组件体才看得清「这块面板到底在做什么」。

export type TabKey = 'map' | 'record' | 'file' | 'help';

/** 回放单位：按时间（秒）/ 按点（个） */
export type PlayMode = 'time' | 'dot';
/** 回放方向：顺序（第 1 点 → 最后）/ 逆序（最后 → 第 1 点） */
export type PlayOrder = 'fwd' | 'rev';

/** 位置修正的三种填法：度数偏移 / 距离偏移 / 目标坐标 */
export type OffsetMode = 'deg' | 'm' | 'target';

export const OFFSET_MODES: { key: OffsetMode; label: string }[] = [
  { key: 'deg', label: '度数' },
  { key: 'm', label: '距离' },
  { key: 'target', label: '目标' },
];

/** 线宽 4；打的点直径与线同粗（4px），历史点直径是线的一半（2px） */
export const LINE_WEIGHT = 4;
export const DOT_RADIUS = LINE_WEIGHT / 2;
export const HIST_RADIUS = LINE_WEIGHT / 4;
/** 线的颜色不是常量：按相邻两点速度取主题色的深浅（见 locationPaint.ts） */
export const COLOR_CURRENT = '#2196F3';
export const COLOR_SELECTED = '#E53935';
/**
 * 记录点的预留色：白芯 + 深色描边。
 * 线本身就是主题色的浅→深阶，点再用主题色会糊在线上；白色芯在任何档位上都跳出来。
 */
export const COLOR_POINT_FILL = '#ffffff';
export const COLOR_POINT_RING = '#2b2a28';
/**
 * 历史点：线宽一半的小白点。
 *
 * 原本想用小墨点，但速度线最快一档本身就是深色，黑点压上去直接消失；
 * 白点在任何档位上都看得见，又只是 2px，不会抢速度线的视觉。
 */
export const COLOR_HIST_POINT = 'rgba(30, 24, 26, 0.28)';
/** 当前点（蓝点）比记录点大一圈，一眼认出「现在在哪」 */
export const CURRENT_SIZE = 10;
/** 回放：走过的轨迹高亮 + 播放头。和选中红、当前蓝都拉开距离 */
export const COLOR_PLAY = '#7C4DFF';

/**
 * 回放的速度档位，做成一排可点的胶囊而不是数字框：
 * 按时间 = 一秒真实时间推进多少秒记录（1× 就是原速）；按点 = 一秒走几个点。
 * 数字框留在「更多」里，档位没覆盖到的自定义值还能填。
 */
export const RATE_TIME = [1, 5, 30, 60, 300, 900];
export const RATE_DOT = [1, 2, 5, 10, 30];
/** 步进档位：按时间 = 秒/步，按点 = 点/步 */
export const STEP_TIME = [1, 5, 10, 30, 60];
export const STEP_DOT = [1, 5, 20];

/** 一条轨迹最多画多少个方向箭头：点很密时按段数均摊，别把地图糊满
 *  （线宽只有 4px，箭头画太密会把速度颜色整个盖住） */
export const ARROW_MAX = 12;
/** 箭头大小：比线宽大一点就够指方向，别把整条线糊成白色 */
export const ARROW_SIZE = 6;

export const TABS: { key: TabKey; label: string }[] = [
  { key: 'map', label: '地图' },
  { key: 'record', label: '记录' },
  { key: 'file', label: '文件' },
  { key: 'help', label: '说明' },
];

/** 里程读数：不到 1 公里就报米，别写成 0.0 km */
export function fmtMeters(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '0 m';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
}

/**
 * 新建定位文件的示例名：日期打底，用户在这个基础上改成「这次要记的事」。
 * 只当默认值用——用户一旦自己动过输入框（nameTouched），就不再被它覆盖。
 */
export function exampleLocationName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} 定位记录`;
}

/** 速度读数：<1 显示 0.x，两位数以上不留小数 */
export function fmtSpeed(kmh: number): string {
  return `${kmh < 10 ? kmh.toFixed(1) : Math.round(kmh)} km/h`;
}

/** 回放进度标签用的时钟：HH:mm:ss（跨天也只是一串数字，够看） */
export function clockOf(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

/** 往 innerHTML 里塞文本前先转义：文件名、备注都是用户自己填的 */
export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
