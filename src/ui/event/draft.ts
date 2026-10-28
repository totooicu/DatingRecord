// 事件表单的草稿状态：新建时给默认值，编辑时从事件回填
import { type Precision, type TimeKind, type TimeSpec } from '../../core/time';
import { parseTimeText, timeText } from './timeText';
import type { DREvent, Participant, RelatedEvent } from '../../core/types';

export interface EventDraft {
  title: string;
  kind: string;
  timeKind: TimeKind;
  start: string;
  end: string;
  precision: Precision;
  raw: string;
  placeName: string;
  content: string;
  tags: string[];
  rating: number | '';
  cost: number | '';
  mood: string;
  intimacyDelta: number | '';
  participantIds: string[];
  cols: string[];
  relatedEvents: RelatedEvent[];
  /** 呈现形态：doc = 普通正文，chat = 聊天形式 */
  viewMode: 'doc' | 'chat';
}

export function initialDraft(
  event: DREvent | undefined,
  defaultPersonId: string | undefined,
  defaultCollectionId: string | undefined,
  existingCols: string[],
): EventDraft {
  return {
    title: event?.title ?? '',
    kind: event?.kind ?? 'date',
    timeKind: event?.time.kind ?? 'instant',
    start: timeText(event?.time.start ?? null),
    end: timeText(event?.time.end ?? null),
    precision: event?.time.precision ?? 'minute',
    raw: event?.time.raw ?? '',
    placeName: event?.place.name ?? '',
    content: event?.content ?? '',
    tags: event?.tags ?? [],
    rating: event?.metrics.rating ?? '',
    cost: event?.metrics.cost ?? '',
    mood: event?.metrics.mood ?? '',
    intimacyDelta: event?.metrics.intimacyDelta ?? '',
    participantIds:
      event?.participants.map((p) => p.personId) ?? (defaultPersonId ? [defaultPersonId] : []),
    cols: existingCols.length ? existingCols : defaultCollectionId ? [defaultCollectionId] : [],
    relatedEvents: event?.relatedEvents ?? [],
    viewMode: event?.viewMode ?? 'doc',
  };
}

export interface EventPayload {
  title: string;
  kind: string;
  time: TimeSpec;
  place: { name?: string };
  participants: Participant[];
  content: string;
  tags: string[];
  metrics: {
    rating?: number;
    cost?: number;
    currency?: string;
    mood?: string;
    intimacyDelta?: number;
  };
  relatedEvents: RelatedEvent[];
  viewMode: 'doc' | 'chat';
}

export function validateDraftTime(d: EventDraft): Partial<Record<'start' | 'end', string>> {
  if (d.timeKind === 'unknown') return {};
  const errors: Partial<Record<'start' | 'end', string>> = {};
  const start = parseTimeText(d.start);
  const end = parseTimeText(d.end);
  const format = '请输入有效时间，格式：YYYY-MM-DD HH:mm';
  if ((d.start || d.timeKind !== 'fuzzy') && !start) errors.start = format;
  if ((d.timeKind === 'interval' || d.timeKind === 'ongoing') && d.end && !end) errors.end = format;
  if (d.timeKind === 'interval' && !d.end) errors.end = format;
  if ((d.timeKind === 'interval' || d.timeKind === 'ongoing') && start && end && end < start) errors.end = '结束时间不能早于开始时间';
  return errors;
}

export function draftToPayload(d: EventDraft): EventPayload {
  if (Object.keys(validateDraftTime(d)).length) throw new Error('时间格式或范围无效');
  return {
    title: d.title.trim() || '未命名事件',
    kind: d.kind,
    time: {
      kind: d.timeKind,
      start: d.timeKind === 'unknown' ? null : parseTimeText(d.start),
      end: d.timeKind === 'interval' || d.timeKind === 'ongoing' ? parseTimeText(d.end) : null,
      precision: d.precision,
      raw: d.timeKind === 'fuzzy' ? d.raw : undefined,
    },
    place: { name: d.placeName || undefined },
    participants: d.participantIds.map((id) => ({ personId: id, role: 'primary' as const })),
    content: d.content,
    tags: d.tags,
    metrics: {
      rating: d.rating === '' ? undefined : Number(d.rating),
      cost: d.cost === '' ? undefined : Number(d.cost),
      currency: d.cost === '' ? undefined : 'CNY',
      mood: d.mood || undefined,
      intimacyDelta: d.intimacyDelta === '' ? undefined : Number(d.intimacyDelta),
    },
    relatedEvents: d.relatedEvents,
    viewMode: d.viewMode,
  };
}
