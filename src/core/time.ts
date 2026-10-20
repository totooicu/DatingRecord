// 时间模型：TimeSpec（语义）+ 混合逻辑时钟 HLC（同步判定）

export type TimeKind =
  | 'instant' // 时刻
  | 'interval' // 区间
  | 'fuzzy' // 模糊：'去年夏天'
  | 'ongoing' // 进行中，无结束
  | 'recurring' // 周期
  | 'unknown'; // 完全不知道

export type Precision = 'second' | 'minute' | 'hour' | 'day' | 'month' | 'year';

export interface TimeSpec {
  kind: TimeKind;
  start?: string | null; // ISO8601（带时区）
  end?: string | null;
  precision?: Precision;
  tz?: string;
  raw?: string; // 用户原文，如「上周三下午」
  allDay?: boolean;
  rrule?: string;
}

export const PRECISION_LABEL: Record<Precision, string> = {
  second: '精确到秒',
  minute: '精确到分钟',
  hour: '精确到小时',
  day: '精确到天',
  month: '精确到月',
  year: '精确到年',
};

export const TIME_KIND_LABEL: Record<TimeKind, string> = {
  instant: '时刻',
  interval: '区间',
  fuzzy: '模糊时间',
  ongoing: '进行中',
  recurring: '周期',
  unknown: '时间未知',
};

// ---------------- 工具 ----------------

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 本地时间 -> datetime-local 输入值 (YYYY-MM-DDTHH:mm) */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local 输入值 -> ISO 字符串（按本地时区） */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** 计算排序用的 UTC 毫秒；无法解析时返回 null（由调用方决定兜底） */
export function toTs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * 事件排序键：恒用 start_ts。
 * 时间未知时用一个极大值把它们排到最后（仍能在时间线落位）。
 */
export function sortKey(startTs: number | null): number {
  return startTs ?? Number.MAX_SAFE_INTEGER;
}

/** 展示用格式化时间 */
export function formatTime(spec: TimeSpec): string {
  const { kind, start, end, precision, raw } = spec;

  if (kind === 'unknown') return raw ? `时间未知（${raw}）` : '时间未知';
  if (!start) return raw || '时间未知';

  const fmt = (iso: string, p?: Precision) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const Y = d.getFullYear();
    const M = pad(d.getMonth() + 1);
    const D = pad(d.getDate());
    const h = pad(d.getHours());
    const m = pad(d.getMinutes());
    if (p === 'year') return `${Y}年`;
    if (p === 'month') return `${Y}年${M}月`;
    if (p === 'day' || spec.allDay) return `${Y}-${M}-${D}`;
    if (p === 'hour') return `${Y}-${M}-${D} ${h}时`;
    return `${Y}-${M}-${D} ${h}:${m}`;
  };

  const prefix = kind === 'fuzzy' ? '约 ' : '';
  let text = prefix + fmt(start, precision);
  if (end && kind !== 'ongoing') {
    const sd = new Date(start);
    const ed = new Date(end);
    const sameDay = sd.toDateString() === ed.toDateString();
    const dayLevel = spec.allDay || precision === 'day' || precision === 'month' || precision === 'year';
    // 同一天的时间段：只显示「09:00–17:00」，避免重复；跨天则显式给第二个日期
    if (sameDay && !dayLevel) {
      const onlyTime = `${pad(ed.getHours())}:${pad(ed.getMinutes())}`;
      text += `–${onlyTime}`;
    } else {
      text += ' → ' + fmt(end, precision);
    }
  }
  if (kind === 'ongoing') text += ' → 至今';
  if (kind === 'fuzzy' && raw) text += `（${raw}）`;
  return text;
}

/** 紧凑时间（列表用）：今天/昨天 + 时分；否则 MM-DD */
export function formatCompact(ts: number | null, allDay: boolean): string {
  if (ts === null) return '时间未知';
  const d = new Date(ts);
  const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (days === 0) return allDay ? '今天' : `今天 ${hm}`;
  if (days === 1) return allDay ? '昨天' : `昨天 ${hm}`;
  return allDay ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

/** 「3 天前」「2 个月前」这类相对描述 */
export function relativeDays(iso: string | null): string | null {
  if (!iso) return null;
  const ts = toTs(iso);
  if (ts === null) return null;
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days < 0) return `${Math.abs(days)} 天后`;
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

// ---------------- 混合逻辑时钟 HLC ----------------
// 格式：毫秒时间戳:计数器(4位):设备ID
// 规则：取 max(物理时间, 已知最大时间)，相等时计数器 +1
// 作用：设备时钟不准/回拨/跨时区时，仍能正确判断「谁更新」

let lastMillis = 0;
let counter = 0;

export function hlcNow(deviceId: string): string {
  const physical = Date.now();
  if (physical > lastMillis) {
    lastMillis = physical;
    counter = 0;
  } else if (physical === lastMillis) {
    counter += 1;
  } else {
    // 时钟回拨：沿用上一个逻辑时间并递增计数器，保证单调递增
    counter += 1;
  }
  return `${lastMillis}:${String(counter).padStart(4, '0')}:${deviceId}`;
}

/** 收到远端 hlc 时调用，把本地逻辑时钟推进到不落后于远端 */
export function hlcReceive(remote: string): void {
  const m = Number(remote.split(':')[0]);
  if (!Number.isNaN(m) && m > lastMillis) {
    lastMillis = m;
    counter = 0;
  }
}

/** 比较两个 hlc：返回 -1 / 0 / 1 */
export function hlcCompare(a: string, b: string): number {
  const [am, ac] = a.split(':');
  const [bm, bc] = b.split(':');
  const amn = Number(am);
  const bmn = Number(bm);
  if (amn !== bmn) return amn < bmn ? -1 : 1;
  const acn = Number(ac ?? 0);
  const bcn = Number(bc ?? 0);
  if (acn !== bcn) return acn < bcn ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
