// 日历的纯逻辑：月网格 + 每天挂了哪些事件集。
//
// 全部用**本地时间**做日界：用户看到的「10 月 22 日」就是他日历上的那天，
// 用 toISOString() 直接切会让东八区的人在晚上 8 点后"穿越"到第二天。
//
// 只放进「有事件」的格子：空日子留白，比给每个集合都撒一遍图标干净得多。

import { listEvents } from './repo/events';
import { getCollection } from './repo/collections';
import { collectionsOfEvent } from './repo/collections/members';
import type { CollectionIcon } from './types';

/** 'YYYY-MM-DD'，本地时区 */
export type DayKey = string;

export interface DayCell {
  key: DayKey;
  /** 1–31 */
  day: number;
  /** 是否属于正在显示的月份（前后补位的日期为 false） */
  inMonth: boolean;
  /** 相对今天：过去 / 今天 / 未来 */
  phase: DayPhase;
}

export type DayPhase = 'past' | 'today' | 'future';

export interface DayCollection {
  id: string;
  name: string;
  icon: CollectionIcon | null;
}

/** 某一天的内容摘要 */
export interface DaySummary {
  /** 当天事件数（含时间未知但 day_key 对得上的） */
  count: number;
  /** 出现的集合，按事件数从多到少 */
  collections: DayCollection[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function dayKeyOf(d: Date): DayKey {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 时间戳 → 本地日键；null/非法值返回 null（时间未知的事件不进日历） */
export function dayKeyOfTs(ts: number | null | undefined): DayKey | null {
  if (ts === null || ts === undefined) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return dayKeyOf(d);
}

/** 今天的日键（一次性取，避免跨零点时同一个渲染里出现两个"今天"） */
export function todayKey(now: Date = new Date()): DayKey {
  return dayKeyOf(now);
}

/** 月份描述：年 + 月（0 起，与 Date 一致） */
export interface MonthRef {
  year: number;
  month: number;
}

export function monthOf(d: Date): MonthRef {
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** 前后挪月份，跨年自动进位 */
export function shiftMonth(m: MonthRef, delta: number): MonthRef {
  const d = new Date(m.year, m.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function monthLabel(m: MonthRef): string {
  return `${m.year} 年 ${m.month + 1} 月`;
}

/**
 * 生成月视图格子。
 *
 * 从周一开始排（中文习惯），前面补到周一、后面补齐整周，
 * 所以永远是 7 的倍数（28 / 35 / 42 格），网格不会出现半行空洞。
 */
export function buildMonthGrid(m: MonthRef, today: DayKey = todayKey()): DayCell[] {
  const first = new Date(m.year, m.month, 1);
  // getDay(): 0=周日…6=周六；换算成「周一是第 0 列」
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(m.year, m.month, 1 - lead);
  const daysInMonth = new Date(m.year, m.month + 1, 0).getDate();
  // 总格数：至少铺满本月，再补齐到最后一周
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;

  const cells: DayCell[] = [];
  for (let i = 0; i < total; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = dayKeyOf(d);
    cells.push({
      key,
      day: d.getDate(),
      inMonth: d.getMonth() === m.month,
      phase: key === today ? 'today' : key < today ? 'past' : 'future',
    });
  }
  return cells;
}

/** 周一…周日 */
export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

/**
 * 把事件摊平成「日键 → 摘要」。
 *
 * 一条事件可能挂在多个集合里；同一天同一个集合只算一次图标。
 * 事件没挂集合时，用它的主集合（primaryCollectionId）兜底——否则
 * 手动建的集合还没来得及加成员，日历上就一片空白，看着像坏了。
 */
export function collectDaySummaries(): Map<DayKey, DaySummary> {
  const out = new Map<DayKey, DaySummary>();
  const cache = new Map<string, { name: string; icon: CollectionIcon | null } | null>();
  const infoOf = (id: string) => {
    if (!cache.has(id)) {
      const c = getCollection(id);
      cache.set(id, c ? { name: c.name, icon: c.icon } : null);
    }
    return cache.get(id) ?? null;
  };

  for (const e of listEvents({})) {
    const key = dayKeyOfTs(e.startTs);
    if (!key) continue;
    let cell = out.get(key);
    if (!cell) {
      cell = { count: 0, collections: [] };
      out.set(key, cell);
    }
    cell.count += 1;

    const ids = collectionsOfEvent(e.id).map((c) => c.id);
    if (ids.length === 0 && e.primaryCollectionId) ids.push(e.primaryCollectionId);

    for (const id of ids) {
      if (cell.collections.some((c) => c.id === id)) continue;
      const c = infoOf(id);
      if (c) cell.collections.push({ id, name: c.name, icon: c.icon });
    }
  }
  return out;
}
