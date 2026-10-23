// 聊天形式事件的消息工具（msg / 旁白）。

import type { ToolDef } from './types';
import { listMessages, getMessageAny, insertMessageAt, appendMessage, updateMessage, moveMessage, deleteMessage } from '../repo/chat';
import type { ChatMessage } from '../types';

function brief(m: ChatMessage): Record<string, unknown> {
  return {
    id: m.id,
    type: m.type,
    personId: m.personId,
    side: m.side,
    body: m.body.length > 200 ? `${m.body.slice(0, 200)}…` : m.body,
    ts: m.ts ? new Date(m.ts).toISOString() : null,
    replyToId: m.replyToId,
    deletedAt: m.deletedAt,
  };
}

function tsOf(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v === 'number') return v;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

export const CHAT_TOOLS: ToolDef[] = [
  {
    name: 'chat.list',
    group: 'chat',
    title: '列出事件的消息',
    desc: '聊天形式事件的全部消息（含旁白），按 order_key 顺序',
    mutating: false,
    params: [{ name: 'eventId', type: 'string', desc: '事件 id（须为 chat 呈现形态）', required: true }],
    run: (a) => listMessages(a.eventId as string).map(brief),
  },
  {
    name: 'chat.append',
    group: 'chat',
    title: '追加消息',
    desc: '在事件对话末尾追加一条消息或旁白',
    mutating: true,
    params: [
      { name: 'eventId', type: 'string', desc: '事件 id', required: true },
      { name: 'body', type: 'string', desc: '正文（Markdown）', required: true },
      { name: 'type', type: 'string', desc: 'msg=消息气泡, divider=旁白', required: false, default: 'msg', enum: ['msg', 'divider'] },
      { name: 'personId', type: 'string', desc: '说话人 id；旁白留空', required: false },
      { name: 'side', type: 'string', desc: 'left=对方, right=自己', required: false, default: 'left', enum: ['left', 'right'] },
      { name: 'ts', type: 'string', desc: '消息时间，省略则只按顺序排列', required: false },
    ],
    run: (a) => {
      const m = appendMessage(a.eventId as string, {
        body: a.body as string,
        type: (a.type as ChatMessage['type']) ?? 'msg',
        personId: (a.personId as string | null) ?? null,
        side: (a.side as ChatMessage['side']) ?? 'left',
        ts: tsOf(a.ts) ?? null,
      });
      return brief(m);
    },
  },
  {
    name: 'chat.insertAt',
    group: 'chat',
    title: '在指定位置插消息',
    desc: '在某条已知消息的上方/下方插入。anchorId 省略时等同追加到末尾',
    mutating: true,
    params: [
      { name: 'eventId', type: 'string', desc: '事件 id', required: true },
      { name: 'anchorId', type: 'string', desc: '锚点消息 id', required: false },
      { name: 'where', type: 'string', desc: 'above=插到锚点上方, below=下方', required: false, default: 'below', enum: ['above', 'below'] },
      { name: 'body', type: 'string', desc: '正文（Markdown）', required: true },
      { name: 'type', type: 'string', desc: 'msg=消息气泡, divider=旁白', required: false, default: 'msg', enum: ['msg', 'divider'] },
      { name: 'personId', type: 'string', desc: '说话人 id', required: false },
      { name: 'side', type: 'string', desc: 'left=对方, right=自己', required: false, default: 'left', enum: ['left', 'right'] },
      { name: 'ts', type: 'string', desc: '消息时间', required: false },
      { name: 'replyToId', type: 'string', desc: '回复的另一条消息 id', required: false },
    ],
    run: (a) => {
      const all = listMessages(a.eventId as string);
      const anchor = a.anchorId ? all.find((m) => m.id === a.anchorId) ?? null : null;
      if (a.anchorId && !anchor) throw new Error(`锚点消息不存在：${a.anchorId}`);
      const m = insertMessageAt(a.eventId as string, anchor, (a.where as 'above' | 'below') ?? 'below', {
        body: a.body as string,
        type: (a.type as ChatMessage['type']) ?? 'msg',
        personId: (a.personId as string | null) ?? null,
        side: (a.side as ChatMessage['side']) ?? 'left',
        ts: tsOf(a.ts) ?? null,
        replyToId: (a.replyToId as string | null) ?? null,
      });
      return brief(m);
    },
  },
  {
    name: 'chat.update',
    group: 'chat',
    title: '修改消息',
    desc: '改正文/说话人/左右/时间/回复关系。只传要改的字段',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '消息 id', required: true },
      { name: 'body', type: 'string', desc: '新正文', required: false },
      { name: 'personId', type: 'string', desc: '新说话人', required: false },
      { name: 'side', type: 'string', desc: '新左右', required: false, enum: ['left', 'right'] },
      { name: 'ts', type: 'string', desc: '新时间；空串表示清除', required: false },
      { name: 'replyToId', type: 'string', desc: '新回复对象；空串表示取消回复', required: false },
      { name: 'type', type: 'string', desc: 'msg/divider', required: false, enum: ['msg', 'divider'] },
    ],
    run: (a) => {
      const patch: Partial<ChatMessage> = {};
      if (a.body !== undefined) patch.body = a.body as string;
      if (a.personId !== undefined) patch.personId = a.personId as string;
      if (a.side !== undefined) patch.side = a.side as ChatMessage['side'];
      if (a.ts !== undefined) patch.ts = tsOf(a.ts) ?? null;
      if (a.replyToId !== undefined) patch.replyToId = (a.replyToId as string) || null;
      if (a.type !== undefined) patch.type = a.type as ChatMessage['type'];
      updateMessage(a.id as string, patch);
      const m = getMessageAny(a.id as string);
      return m ? brief(m) : { ok: true };
    },
  },
  {
    name: 'chat.move',
    group: 'chat',
    title: '上移 / 下移消息',
    desc: '与相邻消息交换顺序。已在顶端/底端时返回 moved=false',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '消息 id', required: true },
      { name: 'dir', type: 'string', desc: 'up=上移, down=下移', required: true, enum: ['up', 'down'] },
    ],
    run: (a) => {
      const ok = moveMessage(a.id as string, a.dir === 'up' ? -1 : 1);
      return { moved: ok };
    },
  },
  {
    name: 'chat.delete',
    group: 'chat',
    title: '删除消息',
    desc: '软删除一条消息（引用它的消息会显示「原消息已删除」）',
    mutating: true,
    params: [{ name: 'id', type: 'string', desc: '消息 id', required: true }],
    run: (a) => {
      deleteMessage(a.id as string);
      return { ok: true };
    },
  },
];
