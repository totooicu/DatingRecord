// 日历的纯逻辑：月网格 + 每天挂了哪些事件集。
//
// 全部用**本地时间**做日界：用户看到的「10 月 22 日」就是他日历上的那天，
// 用 toISOString() 直接切会让东八区的人在晚上 8 点后"穿越"到第二天。
//
// 只放进「有事件」的格子：空日子留白，比给每个集合都撒一遍图标干净得多。

import { listEvents } from './repo/events';
import { getCollection, descendantIdsOf } from './repo/collections';
import { collectionsOfEvent } from './repo/collections/members';
import type { CollectionIcon, DREvent } from './types';

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

/**
 * 日历筛选条件：人物与事件集各自多选。
 *
 * 语义：组内 OR、组间 AND —— 选了「林小满 + 许知夏」且选了「旅行」，
 * 看到的是「这两个人之一 + 属于旅行（含子集合）」的事件。
 * 空数组 = 该维度不筛选。
 */
export interface CalendarFilter {
  personIds: string[];
  collectionIds: string[];
}

export const EMPTY_CALENDAR_FILTER: CalendarFilter = { personIds: [], collectionIds: [] };

export function isCalendarFilterActive(f: CalendarFilter): boolean {
  return f.personIds.length > 0 || f.collectionIds.length > 0;
}

/** 把筛选条件编译成一个判定函数：集合的子孙展开只算一次，逐事件复用 */
function makeMatcher(filter: CalendarFilter): {
  match: (e: DREvent, collectionIds: string[]) => boolean;
  active: boolean;
} {
  const persons = new Set(filter.personIds);
  const collections = filter.collectionIds.length
    ? descendantIdsOf(filter.collectionIds)
    : null;
  return {
    active: persons.size > 0 || !!collections,
    match: (e, collectionIds) => {
      if (persons.size > 0 && !(e.participants ?? []).some((p) => persons.has(p.personId))) {
        return false;
      }
      if (collections) {
        const hit = collectionIds.some((id) => collections.has(id));
        if (!hit && !(e.primaryCollectionId && collections.has(e.primaryCollectionId))) return false;
      }
      return true;
    },
  };
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
 * 逐日推进的日键列表（含两端）。
 *
 * 用本地零点构造 Date 再 +1 天，跨月/跨年由 Date 自己进位；
 * 绝不能拿 ISO 字符串切——东八区晚上 8 点后 toISOString() 会穿越到第二天。
 * 防御：异常超长区间（导入的脏数据）最多展开约 10 年，避免把页面卡死。
 */
export function dayKeysBetween(from: DayKey, to: DayKey): DayKey[] {
  const [y, m, d] = from.split('-').map(Number);
  const cursor = new Date(y, m - 1, d);
  const out: DayKey[] = [];
  for (let i = 0; i < 3660; i += 1) {
    const key = dayKeyOf(cursor);
    if (key > to) break;
    out.push(key);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * 把事件摊平成「日键 → 摘要」。
 *
 * 一条事件可能挂在多个集合里；同一天同一个集合只算一次图标。
 * 事件没挂集合时，用它的主集合（primaryCollectionId）兜底——否则
 * 手动建的集合还没来得及加成员，日历上就一片空白，看着像坏了。
 *
 * 区间事件**逐日展开**：1→3 号的事，1、2、3 每格都要有标记，
 * 否则中间日期看起来像「那天没事」。
 */
export function collectDaySummaries(
  filter: CalendarFilter = EMPTY_CALENDAR_FILTER,
): Map<DayKey, DaySummary> {
  const out = new Map<DayKey, DaySummary>();
  const { match } = makeMatcher(filter);
  const cache = new Map<string, { name: string; icon: CollectionIcon | null } | null>();
  const infoOf = (id: string) => {
    if (!cache.has(id)) {
      const c = getCollection(id);
      cache.set(id, c ? { name: c.name, icon: c.icon } : null);
    }
    return cache.get(id) ?? null;
  };

  for (const e of listEvents({})) {
    const startKey = dayKeyOfTs(e.startTs);
    if (!startKey) continue;

    // endTs 缺失 / 非法 / 早于 start → 退化为单日，避免负循环
    let endKey = dayKeyOfTs(e.endTs);
    if (!endKey || endKey < startKey) endKey = startKey;

    // 集合信息与日期无关，先算好，逐日循环里直接复用
    const ids = collectionsOfEvent(e.id).map((c) => c.id);
    if (ids.length === 0 && e.primaryCollectionId) ids.push(e.primaryCollectionId);
    // 筛选在展开日期之前做：被过滤掉的事件既不计数也不出图标
    if (!match(e, ids)) continue;

    for (const key of dayKeysBetween(startKey, endKey)) {
      let cell = out.get(key);
      if (!cell) {
        cell = { count: 0, collections: [] };
        out.set(key, cell);
      }
      cell.count += 1;
      for (const id of ids) {
        if (cell.collections.some((c) => c.id === id)) continue;
        const c = infoOf(id);
        if (c) cell.collections.push({ id, name: c.name, icon: c.icon });
      }
    }
  }
  return out;
}

/** 跨多天的事件条（月视图里横跨多格的视觉条；单日事件不画条，用格子里的图标） */
export interface SpanBar {
  eventId: string;
  title: string;
  /** 月内裁剪后的起止日键：跨月事件只画本月部分 */
  startKey: DayKey;
  endKey: DayKey;
  /** 起点/终点被月边界裁掉（渲染时画延续箭头） */
  clippedStart: boolean;
  clippedEnd: boolean;
  /** 取第一个集合的图标，条内小图标复用 CollectionIconView */
  icon: CollectionIcon | null;
  /** 第几行；同一行内的条互不重叠 */
  lane: number;
}

/**
 * 收集与指定月份相交的跨天事件，裁剪到月内并分配行号。
 *
 * 贪心策略：先按开始日排序，同一天开始的先排长的——
 * 长条可选的空白最少，先给它定行，后面的短条更容易塞进空隙。
 */
export function collectSpanBars(
  m: MonthRef,
  filter: CalendarFilter = EMPTY_CALENDAR_FILTER,
): SpanBar[] {
  const daysInMonth = new Date(m.year, m.month + 1, 0).getDate();
  const monthStart = dayKeyOf(new Date(m.year, m.month, 1));
  const monthEnd = dayKeyOf(new Date(m.year, m.month, daysInMonth));
  const bars: SpanBar[] = [];
  const { match } = makeMatcher(filter);

  for (const e of listEvents({})) {
    const sKey = dayKeyOfTs(e.startTs);
    if (!sKey) continue;
    let eKey = dayKeyOfTs(e.endTs);
    if (!eKey || eKey < sKey) eKey = sKey;
    if (sKey === eKey) continue; // 单日事件留在格子里，不画条
    if (eKey < monthStart || sKey > monthEnd) continue; // 与本月不相交

    const clippedStart = sKey < monthStart;
    const clippedEnd = eKey > monthEnd;

    // 图标与 DaySummary 同源：先看关联集合，没挂就用主集合兜底
    let icon: CollectionIcon | null = null;
    const cols = collectionsOfEvent(e.id);
    const colIds = cols.map((c) => c.id);
    if (!match(e, colIds)) continue;
    const firstId = cols[0]?.id ?? e.primaryCollectionId;
    if (firstId) icon = getCollection(firstId)?.icon ?? null;

    bars.push({
      eventId: e.id,
      title: e.title,
      startKey: clippedStart ? monthStart : sKey,
      endKey: clippedEnd ? monthEnd : eKey,
      clippedStart,
      clippedEnd,
      icon,
      lane: 0,
    });
  }

  bars.sort((a, b) =>
    a.startKey === b.startKey ? (a.endKey > b.endKey ? -1 : 1) : a.startKey < b.startKey ? -1 : 1,
  );

  // laneEnds[i] = 第 i 行目前占用到的最后一天；早于本条的 startKey 才能共用一行
  const laneEnds: DayKey[] = [];
  for (const b of bars) {
    let lane = laneEnds.findIndex((end) => end < b.startKey);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(b.endKey);
    } else {
      laneEnds[lane] = b.endKey;
    }
    b.lane = lane;
  }
  return bars;
}
