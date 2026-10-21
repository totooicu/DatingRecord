// 事件表单的草稿状态：新建时给默认值，编辑时从事件回填
import { fromLocalInput, toLocalInput, type Precision, type TimeKind, type TimeSpec } from '../../core/time';
import type { DREvent, Participant } from '../../core/types';

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
    start: toLocalInput(event?.time.start ?? null),
    end: toLocalInput(event?.time.end ?? null),
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
}

export function draftToPayload(d: EventDraft): EventPayload {
  return {
    title: d.title.trim() || '未命名事件',
    kind: d.kind,
    time: {
      kind: d.timeKind,
      start: fromLocalInput(d.start),
      end: d.timeKind === 'interval' || d.timeKind === 'ongoing' ? fromLocalInput(d.end) : null,
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
  };
}
