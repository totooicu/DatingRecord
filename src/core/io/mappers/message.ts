// 聊天消息 行 ↔ 对象

import type { Row } from './types';
import type { ChatMessage } from '../../types';
import { getDeviceId } from '../../db';
import { hlcNow } from '../../time';

export function rowToMessage(r: Row): ChatMessage {
  return {
    id: r.id,
    eventId: r.event_id,
    orderKey: r.order_key ?? '',
    type: r.type === 'divider' ? 'divider' : 'msg',
    personId: r.person_id ?? null,
    side: r.side === 'right' ? 'right' : 'left',
    body: r.body ?? '',
    ts: r.ts ?? null,
    deviceId: r.device_id ?? '',
    rev: r.rev ?? 1,
    hlc: r.hlc ?? '',
    deletedAt: r.deleted_at ?? null,
    createdAt: r.created_at ?? '',
    updatedAt: r.updated_at ?? '',
  };
}

export function messageToRow(m: ChatMessage): Row {
  return {
    id: m.id,
    event_id: m.eventId,
    order_key: m.orderKey,
    type: m.type ?? 'msg',
    person_id: m.personId ?? null,
    side: m.side ?? 'left',
    body: m.body ?? '',
    ts: m.ts ?? null,
    device_id: m.deviceId || getDeviceId(),
    rev: m.rev ?? 1,
    hlc: m.hlc || hlcNow(getDeviceId()),
    deleted_at: m.deletedAt ?? null,
    created_at: m.createdAt ?? '',
    updated_at: m.updatedAt ?? '',
  };
}
