// 日历的纯逻辑：月网格 + 每天挂了哪些事件集。
//
// 全部用**本地时间**做日界：用户看到的「10 月 22 日」就是他日历上的那天，
// 用 toISOString() 直接切会让东八区的人在晚上 8 点后"穿越"到第二天。
//
// 只放进「有事件」的格子：空日子留白，比给每个集合都撒一遍图标干净得多。

import { queryAll } from './db';
import { getCollection, descendantIdsOf } from './repo/collections';
import { eventFromRow, safeParse, type EventRow } from './repo/events/rows';
import { isPrivacyMode } from '../privacy';
import type { Collection, CollectionIcon, DREvent, Participant } from './types';

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

/** 某一天里的一条事件（日历格子里滚动的「图标 + 事件名」） */
export interface DayEvent {
  id: string;
  title: string;
  /** 所属事件集的图标；没有集合时为空 */
  icon: CollectionIcon | null;
}

/** 某一天的内容摘要 */
export interface DaySummary {
  /** 当天事件数（含时间未知但 day_key 对得上的） */
  count: number;
  /** 出现的集合，按事件数从多到少 */
  collections: DayCollection[];
  /** 当天开始并结束的事件；跨天事件由日历下方的横条表达，不在这里重复 */
  events: DayEvent[];
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

/** 月份的稳定键：'YYYY-MM'，给月份选择器的计数用 */
export function monthKey(m: MonthRef): string {
  return `${m.year}-${pad2(m.month + 1)}`;
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
 * 日历一次性派生出来的全部数据：日摘要、月计数、各月横条。
 *
 * 旧实现里 collectDaySummaries / collectMonthCounts / collectSpanBars 各自
 * 全表扫一遍事件，且每条事件都单独查一次集合归属与参与者；万级数据下就是
 * ~10 万次 SQL，日历要几十秒。这里改成三条批量 SQL（事件行 / 集合归属 /
 * 参与者）一次性取回，纯 JS 只遍历事件一遍，把 DB 访问降到个位数。
 */
export interface CalendarModel {
  /** 日键 → 当天摘要（事件数、集合、单日事件标题） */
  summaries: Map<DayKey, DaySummary>;
  /** 'YYYY-MM' → 该月事件数（跨月事件在覆盖到的每个月各计一次） */
  monthCounts: Map<string, number>;
  /** 'YYYY-MM' → 该月横条（已分配行号） */
  spanBarsByMonth: Map<string, SpanBar[]>;
}

export function computeCalendarModel(
  filter: CalendarFilter = EMPTY_CALENDAR_FILTER,
): CalendarModel {
  // 1) 批量取数：事件行 / 集合归属 / 参与者，各一条 SQL，绝不逐事件查库
  const eventRows = queryAll<EventRow>(
    `SELECT * FROM events WHERE deleted_at IS NULL
     ${isPrivacyMode() ? 'AND is_private = 0' : ''}
     ORDER BY COALESCE(start_ts, 9223372036854775807) DESC, created_at DESC`,
    [],
  );
  const memRows = queryAll<{ collection_id: string; member_id: string }>(
    `SELECT collection_id, member_id FROM collection_members
     WHERE member_type = 'event' AND deleted_at IS NULL`,
    [],
  );
  // 参与者只在「按人物筛选」时才需要，避免无谓地拉全表
  const needPersons = filter.personIds.length > 0;
  const partRows = needPersons
    ? queryAll<{ event_id: string; person_id: string; role: string; note: string; per_person_json: string }>(
        'SELECT event_id, person_id, role, note, per_person_json FROM event_participants',
        [],
      )
    : [];

  // 集合只解析一次，后续按 id 直接取
  const colById = new Map<string, Collection>();
  const resolveCol = (id: string): Collection | null => {
    let c = colById.get(id);
    if (!c) {
      c = getCollection(id) ?? undefined;
      if (c) colById.set(id, c);
    }
    return c ?? null;
  };

  // 事件 → 集合 id 列表（保持 membership 顺序，第一个即主图标来源）
  const evCols = new Map<string, string[]>();
  for (const r of memRows) {
    let arr = evCols.get(r.member_id);
    if (!arr) {
      arr = [];
      evCols.set(r.member_id, arr);
    }
    arr.push(r.collection_id);
  }

  // 事件 → 参与者
  const evParts = new Map<string, Participant[]>();
  if (needPersons) {
    for (const r of partRows) {
      let arr = evParts.get(r.event_id);
      if (!arr) {
        arr = [];
        evParts.set(r.event_id, arr);
      }
      arr.push({
        personId: r.person_id,
        role: r.role as Participant['role'],
        note: r.note || undefined,
        perPerson: safeParse<Record<string, unknown>>(r.per_person_json, {}),
      });
    }
  }

  // 组装事件对象（只补上日历需要的字段；participants 由上面的批量结果注入）
  const events: DREvent[] = eventRows.map((r) => eventFromRow(r, evParts.get(r.id) ?? []));

  const matcher = makeMatcher(filter);
  const summaries = new Map<DayKey, DaySummary>();
  const monthCounts = new Map<string, number>();
  const spanBarsByMonth = new Map<string, SpanBar[]>();
  // 集合 id → {name, icon}，跨事件复用，避免反复 getCollection
  const colInfo = new Map<string, { name: string; icon: CollectionIcon | null } | null>();
  const infoOf = (id: string) => {
    let i = colInfo.get(id);
    if (!i) {
      const c = resolveCol(id);
      i = c ? { name: c.name, icon: c.icon } : null;
      colInfo.set(id, i);
    }
    return i ?? null;
  };

  for (const e of events) {
    const startKey = dayKeyOfTs(e.startTs);
    if (!startKey) continue;
    // endTs 缺失 / 非法 / 早于 start → 退化为单日，避免负循环
    let endKey = dayKeyOfTs(e.endTs);
    if (!endKey || endKey < startKey) endKey = startKey;

    const ids = evCols.get(e.id) ?? [];
    const colIds = ids.length > 0 ? ids : e.primaryCollectionId ? [e.primaryCollectionId] : [];
    // 筛选在展开日期之前做：被过滤掉的事件既不计数也不出图标
    if (!matcher.match(e, colIds)) continue;

    const singleDay = startKey === endKey;

    // 逐日展开：当天摘要（单日事件才放标题，跨天事件由横条表达）
    for (const key of dayKeysBetween(startKey, endKey)) {
      let cell = summaries.get(key);
      if (!cell) {
        cell = { count: 0, collections: [], events: [] };
        summaries.set(key, cell);
      }
      cell.count += 1;
      if (singleDay) {
        const firstId = colIds[0] ?? e.primaryCollectionId;
        const icon = firstId ? (infoOf(firstId)?.icon ?? null) : null;
        cell.events.push({ id: e.id, title: e.title, icon });
      }
      for (const id of colIds) {
        if (cell.collections.some((c) => c.id === id)) continue;
        const c = infoOf(id);
        if (c) cell.collections.push({ id, name: c.name, icon: c.icon });
      }
    }

    // 按月展开：月计数 + 当月横条（裁剪到月内、分配行号留到全月扫完之后）
    const [sy, sm] = startKey.split('-').map(Number);
    const [ey, em] = endKey.split('-').map(Number);
    const endIdx = ey * 12 + em - 1;
    let y = sy;
    let m = sm - 1;
    for (let i = 0; i < 2400; i += 1) {
      const idx = y * 12 + m;
      if (idx > endIdx) break;
      const mKey = `${y}-${pad2(m + 1)}`;
      monthCounts.set(mKey, (monthCounts.get(mKey) ?? 0) + 1);

      const monthStart = dayKeyOf(new Date(y, m, 1));
      const monthEnd = dayKeyOf(new Date(y, m + 1, 0));
      const first = colIds.length
        ? resolveCol(colIds[0])
        : e.primaryCollectionId
          ? resolveCol(e.primaryCollectionId)
          : null;
      let arr = spanBarsByMonth.get(mKey);
      if (!arr) {
        arr = [];
        spanBarsByMonth.set(mKey, arr);
      }
      arr.push({
        eventId: e.id,
        title: e.title,
        startKey: startKey < monthStart ? monthStart : startKey,
        endKey: endKey > monthEnd ? monthEnd : endKey,
        clippedStart: startKey < monthStart,
        clippedEnd: endKey > monthEnd,
        icon: first?.icon ?? null,
        toneSeed: first?.name ?? '',
        lane: 0,
      });

      m += 1;
      if (m === 12) {
        m = 0;
        y += 1;
      }
    }
  }

  // 每个月的横条独立排序 + 贪心分配行号（与旧 collectSpanBars 同策略）
  for (const arr of spanBarsByMonth.values()) {
    arr.sort((a, b) =>
      a.startKey === b.startKey ? (a.endKey > b.endKey ? -1 : 1) : a.startKey < b.startKey ? -1 : 1,
    );
    const laneEnds: DayKey[] = [];
    for (const b of arr) {
      let lane = laneEnds.findIndex((end) => end < b.startKey);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(b.endKey);
      } else {
        laneEnds[lane] = b.endKey;
      }
      b.lane = lane;
    }
  }

  return { summaries, monthCounts, spanBarsByMonth };
}

/**
 * 事件条：月视图里横跨若干日期格的视觉条。
 *
 * 单日事件（startKey === endKey）也走这套框架，只是只占一格——
 * 这样单日 / 跨日事件外观统一，渲染层不用两套逻辑。
 * 条内内容超宽时由前端做跑马灯滚动。
 */
export interface SpanBar {
  eventId: string;
  title: string;
  /** 月内裁剪后的起止日键：跨月事件只画本月部分；单日事件起止相同 */
  startKey: DayKey;
  endKey: DayKey;
  /** 起点/终点被月边界裁掉（渲染时画延续箭头） */
  clippedStart: boolean;
  clippedEnd: boolean;
  /** 取第一个集合的图标，条内小图标复用 CollectionIconView */
  icon: CollectionIcon | null;
  /** 第一个集合的名字：没设图标时按它取默认配色，保证同一集合的事件同色 */
  toneSeed: string;
  /** 第几行；同一行内的条互不重叠 */
  lane: number;
}
