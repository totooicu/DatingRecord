// 事件集「表格阅览」的行装配（F-C10）。
//
// 表格是同一批事件的另一种排版，不是新实体：这里只把 DREvent 压成
// 展示需要的几列，UI 与 AI 工具（collection.table）共用，避免两边各写一套
// 「人物怎么拼、时间怎么格式化」。
//
// 排序仍按原始值（startTs / rating / cost）做，格式化文本只负责显示——
// 「今天」「2026-10-31 21:30」这类文本没法正确比较大小。

import type { DREvent } from '../../types';
import { EVENT_KINDS } from '../events';
import { getPerson } from '../persons';
import { formatTime } from '../../time';

export interface EventTableRow {
  id: string;
  title: string;
  /** 展示用时间文本 */
  time: string;
  /** 排序用时间戳；时间未知为 null（排最后） */
  startTs: number | null;
  kind: string;
  kindLabel: string;
  /** 参与者名字，顿号分隔；没有则为空串 */
  persons: string;
  /** 地点名，没有地址时退回地址 */
  place: string;
  /** 标签，空格分隔（表格里不再画 chip） */
  tags: string;
  rating: number | null;
  cost: number | null;
}

export function eventTableRows(events: DREvent[]): EventTableRow[] {
  return events.map((e) => {
    const kindLabel = EVENT_KINDS.find((k) => k.value === e.kind)?.label ?? e.kind;
    const persons = e.participants
      .map((p) => getPerson(p.personId)?.displayName ?? '')
      .filter(Boolean)
      .join('、');
    return {
      id: e.id,
      title: e.title,
      time: formatTime(e.time),
      startTs: e.startTs,
      kind: e.kind,
      kindLabel,
      persons,
      place: e.place.name || e.place.address || '',
      tags: e.tags.join(' '),
      rating: typeof e.metrics.rating === 'number' ? e.metrics.rating : null,
      cost: typeof e.metrics.cost === 'number' ? e.metrics.cost : null,
    };
  });
}
