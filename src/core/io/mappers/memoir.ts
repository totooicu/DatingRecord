// 回忆录 行 ↔ 对象

import type { Row } from './types';
import { getDeviceId } from '../../db';
import { hlcNow } from '../../time';
import type { Memoir, MemoirPage, MemoirScope } from '../../types';

function parseScope(text: unknown): MemoirScope {
  try {
    const o = JSON.parse(String(text ?? '{}')) as Partial<MemoirScope>;
    return {
      eventIds: Array.isArray(o.eventIds) ? o.eventIds.filter((x): x is string => typeof x === 'string') : [],
      from: typeof o.from === 'string' ? o.from : null,
      to: typeof o.to === 'string' ? o.to : null,
      frozenAt: typeof o.frozenAt === 'string' ? o.frozenAt : '',
    };
  } catch {
    return { eventIds: [], from: null, to: null, frozenAt: '' };
  }
}

function parsePages(text: unknown): MemoirPage[] {
  try {
    const arr = JSON.parse(String(text ?? '[]'));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p): p is MemoirPage => !!p && typeof p === 'object' && typeof p.eventId === 'string')
      .map((p) => ({ ...p, id: typeof p.id === 'string' && p.id ? p.id : p.eventId }));
  } catch {
    return [];
  }
}

export function rowToMemoir(r: Row): Memoir {
  return {
    id: r.id,
    collectionId: r.collection_id ?? '',
    title: r.title ?? '',
    subtitle: r.subtitle ?? '',
    coverFileId: r.cover_file_id ?? null,
    playlistId: r.playlist_id ?? null,
    scope: parseScope(r.scope_json),
    pages: parsePages(r.pages_json),
    source: r.source === 'ai' ? 'ai' : 'manual',
    aiModel: r.ai_model ?? null,
    deviceId: r.device_id ?? '',
    rev: r.rev ?? 1,
    hlc: r.hlc ?? '',
    deletedAt: r.deleted_at ?? null,
    createdAt: r.created_at ?? '',
    updatedAt: r.updated_at ?? '',
  };
}

export function memoirToRow(m: Memoir): Row {
  return {
    id: m.id,
    collection_id: m.collectionId,
    title: m.title ?? '',
    subtitle: m.subtitle ?? '',
    cover_file_id: m.coverFileId ?? null,
    playlist_id: m.playlistId ?? null,
    scope_json: JSON.stringify(m.scope ?? { eventIds: [], from: null, to: null, frozenAt: '' }),
    pages_json: JSON.stringify(m.pages ?? []),
    source: m.source === 'ai' ? 'ai' : 'manual',
    ai_model: m.aiModel ?? null,
    device_id: m.deviceId || getDeviceId(),
    rev: m.rev ?? 1,
    hlc: m.hlc || hlcNow(getDeviceId()),
    deleted_at: m.deletedAt ?? null,
    created_at: m.createdAt || new Date().toISOString(),
    updated_at: m.updatedAt || new Date().toISOString(),
  };
}
