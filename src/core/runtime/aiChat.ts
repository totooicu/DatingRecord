// AI 聊天的运行时单例。
//
// 为什么独立出来：原来轮次执行态（busy / activity / roundNo / err / items / history）
// 全在 LabAiSection 的组件 state 里——一旦离开「设置 → AI → AI 对话」页，
// 组件卸载，执行中的 agent 循环虽然还在跑（闭包没死），但所有状态更新都打到了
// 已卸载的组件上，回来时 useState 重置成一片空白，等于「看不见 AI 在干活」。
//
// 现在把这些「与页面存活无关」的状态和轮次执行循环挪到这个模块级单例，
// 组件只是它的订阅式视图：离开页面单例照跑，head 上的任务图标照常变色，
// 回来时重新订阅就能看到完整进度。输入框、附件选择这类纯 UI 状态仍留在组件。

import { useEffect, useState } from 'react';
import {
  agentSystemPrompt,
  runAgentTurn,
  type AgentEvent,
  type AgentMessage,
} from '../ai/agent';
import {
  attachText,
  imagesOf,
  type Attachment,
} from '../ai/attach';
import type { AiModel } from '../ai';
import {
  createSession,
  listSessions,
  renameSession,
  saveSession,
  titleOf,
  type AiSession,
} from '../ai/sessions';
import {
  revertAiTurn,
  stageAiTurn,
  summarizeOps,
} from '../snapshots';
import { showToast } from '../../ui/toast';
import { addTask, finishTask, markTaskRead, updateTask } from './store';

/** 聊天里的一条气泡（与 LabAiSection 共用） */
export interface AiItem {
  kind: 'user' | 'assistant';
  text: string;
  tools?: string[];
  /** 这一轮的自动快照（可回退） */
  snapshotId?: string | null;
  /** 这一轮改动暂存在哪条成果里（待执行 / 放弃） */
  pendingId?: string | null;
  attachments?: Attachment[];
}

const TASK_ID = 'ai-chat';

export interface AiChatState {
  busy: boolean;
  activity: string[];
  roundNo: number;
  err: string | null;
  items: AiItem[];
  history: AgentMessage[];
  sessionId: string | null;
  /** 上一轮是否已停止 */
  aborted: boolean;
}

let state: AiChatState = {
  busy: false,
  activity: [],
  roundNo: 0,
  err: null,
  items: [],
  history: [],
  sessionId: null,
  aborted: false,
};
const listeners = new Set<(s: AiChatState) => void>();
let abortRef: AbortController | null = null;

function emit(): void {
  for (const fn of listeners) fn(state);
}

function patch(p: Partial<AiChatState>): void {
  state = { ...state, ...p };
  emit();
}

export function subscribe(cb: (s: AiChatState) => void): () => void {
  listeners.add(cb);
  cb(state);
  return () => {
    listeners.delete(cb);
  };
}

export function getState(): AiChatState {
  return state;
}

/** React hook：组件订阅单例状态 */
export function useAiChat(): AiChatState {
  const [s, setS] = useState<AiChatState>(state);
  useEffect(() => subscribe(setS), []);
  return s;
}

/** 打开 AI 对话页时调用：把这条任务的「未读」通知清掉 */
export function markChatRead(): void {
  markTaskRead('ai-chat');
}

function getSession(id: string): AiSession | undefined {
  return listSessions().find((s) => s.id === id);
}

function persistSession(hist: AgentMessage[], its: AiItem[]): void {
  const firstUser = its.find((x) => x.kind === 'user');
  const title = titleOf(firstUser?.text ?? '');
  const now = new Date().toISOString();
  let id = state.sessionId;
  const existing = id ? getSession(id) : undefined;
  if (!existing) {
    id = createSession().id;
    patch({ sessionId: id });
  }
  const next: AiSession = {
    id: id!,
    title,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages: hist,
    items: its as AiSession['items'],
  };
  saveSession(next);
}

/** 发一条消息并跑 agent 循环（与页面存活无关，离开页面照跑） */
export async function sendTurn(text: string, sent: Attachment[], model: AiModel): Promise<void> {
  const t = text.trim();
  if ((!t && sent.length === 0) || state.busy) return;
  if (!model) {
    patch({ err: '还没有可用的模型。去「设置 → AI → 模型」配一个别名和密钥。' });
    return;
  }
  patch({ err: null });
  const userItem: AiItem = { kind: 'user', text: t || '（只发了附件）', attachments: sent };
  patch({ items: [...state.items, userItem], activity: [], roundNo: 0, busy: true });

  // 任务进 head：running 态，点图标跳 AI 对话页
  addTask({
    id: TASK_ID,
    kind: 'ai-chat',
    title: 'AI 正在回复你',
    status: 'running',
    target: { type: 'settings', key: 'labAi' },
    note: '正在思考…',
  });

  const ac = new AbortController();
  abortRef = ac;
  const base: AgentMessage[] = state.history.length
    ? state.history
    : [{ role: 'system', content: agentSystemPrompt() }];

  const body = [attachText(sent), t].filter(Boolean).join('\n\n');
  const imgs = imagesOf(sent);
  const userMsg: AgentMessage = imgs.length
    ? { role: 'user', content: body, images: imgs }
    : { role: 'user', content: body };

  const onEvent = (e: AgentEvent) => {
    if (e.type === 'round') {
      patch({ roundNo: e.n });
      updateTask(TASK_ID, { note: `第 ${e.n} 轮…` });
    } else if (e.type === 'tool_start') {
      const argKeys = Object.keys(e.args).filter(
        (k) => e.args[k] !== undefined && e.args[k] !== null && e.args[k] !== '',
      );
      const line = `调用 ${e.name}${argKeys.length ? `（${argKeys.join('、')}）` : ''}`;
      patch({ activity: [...state.activity, line] });
      updateTask(TASK_ID, { note: line });
    } else if (e.type === 'tool_end') {
      patch({ activity: [...state.activity, `${e.ok ? '完成' : '失败'} ${e.name}${e.ok ? '' : `：${e.preview}`}`] });
    } else if (e.type === 'snapshot') {
      patch({
        activity: [...state.activity, e.id ? '已自动备份当前数据' : '自动备份失败（仍可继续，但无法一键回退）'],
      });
    } else if (e.type === 'error') {
      patch({ err: e.message });
    }
  };

  try {
    const lastSnap = [...state.items].reverse().find((x) => x.kind === 'assistant' && x.snapshotId);
    const res = await runAgentTurn({
      model,
      history: [...base, userMsg],
      signal: ac.signal,
      onEvent,
      resumeSnapshotId: lastSnap?.snapshotId ?? null,
    });
    if (res.error) {
      if (res.snapshotId) await revertAiTurn(res.snapshotId);
      patch({
        items: state.items.filter((x) => x !== userItem),
        err: res.error,
        busy: false,
        activity: [],
        roundNo: 0,
      });
      finishTask(TASK_ID, false, res.error, 'AI 回复失败');
      return;
    }
    const hist = res.messages;
    const staged = res.snapshotId ? await stageAiTurn(res.snapshotId, res.ops, summarizeOps(res.ops)) : null;
    const pendingId = staged?.id ?? null;
    const last = [...hist].reverse().find((m) => m.role === 'assistant' && !(m.role === 'assistant' && m.toolCalls?.length));
    const replyText = last && last.role === 'assistant' ? last.content : '';
    const nextItems: AiItem[] = [
      ...state.items,
      userItem,
      {
        kind: 'assistant',
        text: replyText || (res.aborted ? '（已停止）' : '（这一轮没有文本回复）'),
        tools: res.usedTools.length ? res.usedTools : undefined,
        snapshotId: staged ? null : res.snapshotId,
        pendingId,
      },
    ];
    patch({ history: hist, items: nextItems, busy: false, activity: [], roundNo: 0, aborted: !!res.aborted });
    showToast(
      staged
        ? '改动已暂存，去「成果」确认后执行'
        : res.snapshotId
          ? '这一轮库没有变化，自动备份已留在「成果」里'
          : res.aborted
            ? '已停止本轮'
            : 'AI 已完成，可以继续提问或离开',
    );
    persistSession(hist, nextItems);
    finishTask(
      TASK_ID,
      true,
      res.aborted ? '本轮已停止' : staged ? '改动已暂存，待你确认' : '已完成',
      'AI 已完成回复',
    );
  } catch (e) {
    patch({
      items: state.items.filter((x) => x !== userItem),
      err: e instanceof Error ? e.message : String(e),
      busy: false,
      activity: [],
      roundNo: 0,
    });
    finishTask(TASK_ID, false, e instanceof Error ? e.message : String(e), 'AI 回复失败');
  } finally {
    abortRef = null;
  }
}

export function stopTurn(): void {
  abortRef?.abort();
}

/** 写一条错误提示（UI 用，单例统一持有 err） */
export function setErr(msg: string | null): void {
  patch({ err: msg });
}

/** 替换整段气泡并落盘（applySnap / rollback 等需要改完后存会话） */
export function setItems(next: AiItem[]): void {
  patch({ items: next });
  if (state.sessionId) persistSession(state.history, next);
}

// ---- 会话管理（组件调用单例 setter，保持 items/history/sessionId 一致） ----

export function newSession(): void {
  patch({ sessionId: null, history: [], items: [], err: null, aborted: false });
}

export function loadSessionInto(id: string): void {
  const s = getSession(id);
  if (!s) return;
  patch({ sessionId: s.id, history: s.messages, items: s.items as AiItem[], err: null, aborted: false });
}

export function removeItem(index: number): void {
  const next = state.items.filter((_, i) => i !== index);
  patch({ items: next });
  if (state.sessionId) persistSession(state.history, next);
}

export function renameCurrentSession(title: string): void {
  if (!state.sessionId) return;
  renameSession(state.sessionId, title);
}

export function currentSessionId(): string | null {
  return state.sessionId;
}
