// 事件仓储入口。原 328 行的 events.ts 拆成：
//   kinds（类型字典）· rows（行映射）· read（读取与统计）· write（写入）
// 这里原样转出，外部 import '../repo/events' 的写法不用改。

export { EVENT_KINDS } from './kinds';
export type { EventRow } from './rows';
export {
  listEvents,
  getEvent,
  listDeletedEvents,
  globalStats,
  type EventFilter,
} from './read';
export {
  createEvent,
  updateEvent,
  deleteEvent,
  restoreEvent,
  purgeEvent,
  type EventInput,
} from './write';
export { RELATION_LABELS, RELATION_TYPES, normalizeRelated, stripRefsTo, incomingRefs } from './related';
