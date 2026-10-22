// 聊天消息的读写。
//
// 消息独立成表，但语义上仍从属于事件：查的时候按事件查、按 order_key 排，
// 删除事件时它的消息一起走（见 events/write.ts 的级联）。
//
// 每条改动都单独写一条 oplog（entity='event_message'），
// 这样撤销能精确到「刚删的那句话」，而不是把整场对话回滚。
import { queryAll, queryOne, run, getDeviceId } from '../db';
import { appendOplog } from '../db/oplog';
import { newId } from '../id';
import { hlcNow } from '../time';
import { orderKeyBetween, FIRST_ORDER_KEY } from '../order';
import type { ChatMessage } from '../types';

const now = () => new Date().toISOString();

/** 某场事件的全部消息，按排序键升序 */
export function listMessages(eventId: string): ChatMessage[] {
  const rows = queryAll<Record<string, never>>(
    `SELECT * FROM event_messages
     WHERE event_id = ? AND deleted_at IS NULL
     ORDER BY order_key ASC`,
    [eventId],
  );
  return rows.map((r) => ({
    id: r.id as string,
    eventId: r.event_id as string,
    orderKey: r.order_key as string,
    type: r.type === 'divider' ? 'divider' : 'msg',
    personId: (r.person_id as string | null) ?? null,
    side: r.side === 'right' ? 'right' : 'left',
    body: (r.body as string) ?? '',
    ts: (r.ts as number | null) ?? null,
    deviceId: (r.device_id as string) ?? '',
    rev: (r.rev as number) ?? 1,
    hlc: (r.hlc as string) ?? '',
    deletedAt: (r.deleted_at as string | null) ?? null,
    createdAt: (r.created_at as string) ?? '',
    updatedAt: (r.updated_at as string) ?? '',
  }));
}

/** 取一条（含已删除的，撤销/恢复要用） */
export function getMessage(id: string): ChatMessage | null {
  const r = queryOne<Record<string, never>>('SELECT * FROM event_messages WHERE id = ?', [id]);
  if (!r) return null;
  return listMessages(r.event_id as string).find((m) => m.id === id) ?? null;
}

function insert(initial: Partial<ChatMessage> & { eventId: string; type: ChatMessage['type'] }): ChatMessage {
  const m: ChatMessage = {
    id: newId('msg'),
    eventId: initial.eventId,
    orderKey: initial.orderKey ?? FIRST_ORDER_KEY,
    type: initial.type,
    personId: initial.personId ?? null,
    side: initial.side ?? 'left',
    body: initial.body ?? '',
    ts: initial.ts ?? null,
    deviceId: getDeviceId(),
    rev: 1,
    hlc: hlcNow(getDeviceId()),
    deletedAt: null,
    createdAt: now(),
    updatedAt: now(),
    ...(initial.id ? { id: initial.id } : {}),
    ...(initial.hlc ? { hlc: initial.hlc } : {}),
    ...(initial.rev ? { rev: initial.rev } : {}),
  };
  run(
    `INSERT INTO event_messages
       (id, event_id, order_key, type, person_id, side, body, ts,
        device_id, rev, hlc, deleted_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      m.id, m.eventId, m.orderKey, m.type, m.personId, m.side, m.body, m.ts,
      m.deviceId, m.rev, m.hlc, m.deletedAt, m.createdAt, m.updatedAt,
    ],
  );
  appendOplog('event_message', m.id, 'insert', { title: m.body.slice(0, 20) });
  return m;
}

/**
 * 在 anchor 之上 / 之下插入一条。
 * 排序键取相邻两条的中点——两端并发插入不会撞车，也不用重排全表。
 */
export function insertMessageAt(
  eventId: string,
  anchor: ChatMessage | null,
  where: 'above' | 'below',
  init: Partial<ChatMessage> = {},
): ChatMessage {
  const all = listMessages(eventId);
  const idx = anchor ? all.findIndex((m) => m.id === anchor.id) : -1;
  let prev: string | null;
  let next: string | null;
  if (idx < 0) {
    // 没有锚点：追加到末尾
    prev = all.length ? all[all.length - 1].orderKey : null;
    next = null;
  } else if (where === 'above') {
    prev = idx > 0 ? all[idx - 1].orderKey : null;
    next = all[idx].orderKey;
  } else {
    prev = all[idx].orderKey;
    next = idx + 1 < all.length ? all[idx + 1].orderKey : null;
  }
  return insert({
    eventId,
    type: init.type ?? 'msg',
    orderKey: orderKeyBetween(prev, next),
    ...init,
    id: init.id,
  });
}

/** 追加到末尾（空对话的第一条、或从底部继续记） */
export function appendMessage(
  eventId: string,
  init: Partial<ChatMessage> = {},
): ChatMessage {
  return insertMessageAt(eventId, null, 'below', init);
}

export function updateMessage(id: string, patch: Partial<ChatMessage>): void {
  const cur = queryOne<{ event_id: string; body: string; hlc: string }>(
    'SELECT event_id, body, hlc FROM event_messages WHERE id = ?',
    [id],
  );
  if (!cur) return;
  const sets: string[] = [];
  const args: unknown[] = [];
  const put = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.body !== undefined) put('body', patch.body);
  if (patch.personId !== undefined) put('person_id', patch.personId);
  if (patch.side !== undefined) put('side', patch.side);
  if (patch.ts !== undefined) put('ts', patch.ts);
  if (patch.type !== undefined) put('type', patch.type);
  if (patch.orderKey !== undefined) put('order_key', patch.orderKey);
  put('updated_at', now());
  const hlc = hlcNow(getDeviceId());
  put('hlc', hlc);
  args.push(id);
  run(`UPDATE event_messages SET ${sets.join(', ')} WHERE id = ?`, args);
  appendOplog('event_message', id, 'update', {
    title: (patch.body ?? cur.body).slice(0, 20),
    prev: { body: cur.body, hlc: cur.hlc },
  });
}

/** 软删：同步时才知道对端是删了还是改了 */
export function deleteMessage(id: string): void {
  const cur = queryOne<{ body: string; hlc: string }>(
    'SELECT body, hlc FROM event_messages WHERE id = ?',
    [id],
  );
  if (!cur) return;
  run('UPDATE event_messages SET deleted_at = ?, hlc = ?, updated_at = ? WHERE id = ?', [
    now(),
    hlcNow(getDeviceId()),
    now(),
    id,
  ]);
  appendOplog('event_message', id, 'delete', { title: cur.body.slice(0, 20), prev: { hlc: cur.hlc } });
}

/** 事件整体删除时级联清掉它的消息（软删，保留同步证据） */
export function deleteMessagesOfEvent(eventId: string): void {
  run('UPDATE event_messages SET deleted_at = ?, updated_at = ? WHERE event_id = ?', [
    now(),
    now(),
    eventId,
  ]);
}

/** 事件从回收站恢复时，它的消息跟着回来 */
export function restoreMessagesOfEvent(eventId: string): void {
  run('UPDATE event_messages SET deleted_at = NULL, updated_at = ? WHERE event_id = ?', [
    now(),
    eventId,
  ]);
}
