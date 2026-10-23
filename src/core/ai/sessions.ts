// AI 会话持久化。
//
// 解决的问题：以前对话只活在 LabAiSection 的 useState 里——刷新即丢，
// 退出设置页再回来也丢（组件卸载）。用户说「被中断也能继续完成」，
// 靠的就是把会话落盘：整段 agent 对话（喂模型用的 messages）+ 展示用的
// 气泡（items）一起存，回来原样接上，模型上下文不断。
//
// 存储位置：SQLite 的 meta 表，一个 key 一条 JSON（'ai.sessions'）。
// 为什么不用新的 IndexedDB store：meta 在库里，天然跟着备份/导出/同步走，
// 不用给 idb 升版本；会话是几十 KB 的文本，塞得下。
// 图片附件（data URL）是大头，所以有数量 + 总体积两道闸（见 save）。
//
// CLI 没有「会话」概念——每次调用都是独立一轮，用完即走，
// 所以这个模块只服务 UI；agent 循环本身（runAgentTurn）不依赖它。

import { getDbInstance } from '../db/state';
import { newId } from '../id';
import type { AgentMessage } from './agent';

/** 展示用的气泡。和 UI 侧的 Item 一一对应，但定义在这层——
 *  持久化的东西不能依赖 React 组件文件，否则 core 就被 UI 钓着走了 */
export interface SessionItem {
  kind: 'user' | 'assistant';
  text: string;
  /** 这一轮调用了哪些工具 */
  tools?: string[];
  /** 这一轮的自动快照（可回退） */
  snapshotId?: string | null;
  /** 用户消息带的附件（只在界面上展示，正文已拼进 text 发给模型） */
  attachments?: unknown[];
}

export interface AiSession {
  id: string;
  /** 标题：取第一条用户消息的前十几个字，会话列表里认得出是谁 */
  title: string;
  createdAt: string;
  updatedAt: string;
  /** 喂模型用的完整对话（system + user/assistant/tool） */
  messages: AgentMessage[];
  /** 界面上的气泡流 */
  items: SessionItem[];
}

const META_KEY = 'ai.sessions';
/** 最多留几个会话；每个都带整段上下文，囤多了导出备份会疯长 */
const MAX_SESSIONS = 20;
/** 所有会话序列化后的总体积上限，超了从最旧的开始扔 */
const MAX_TOTAL_CHARS = 3_000_000;

function readAll(): AiSession[] {
  const d = getDbInstance();
  if (!d) return [];
  const res = d.exec(`SELECT value FROM meta WHERE key = '${META_KEY}'`);
  const raw = res[0]?.values?.[0]?.[0];
  if (!raw) return [];
  try {
    const arr = JSON.parse(String(raw)) as AiSession[];
    return Array.isArray(arr) ? arr.filter((s) => s && typeof s.id === 'string') : [];
  } catch {
    return [];
  }
}

function writeAll(list: AiSession[]): void {
  const d = getDbInstance();
  if (!d) return;
  d.run(`INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [META_KEY, JSON.stringify(list)]);
}

/** 全部会话，新的在前 */
export function listSessions(): AiSession[] {
  return readAll();
}

export function getSession(id: string): AiSession | null {
  return readAll().find((s) => s.id === id) ?? null;
}

/** 从一条用户消息概括标题：前 16 个字，超了省略号 */
export function titleOf(firstUserText: string): string {
  const t = firstUserText.replace(/\s+/g, ' ').trim();
  if (!t) return '新会话';
  return t.length > 16 ? `${t.slice(0, 16)}…` : t;
}

/**
 * 存一个会话（新建或更新）。返回存好的那份。
 *
 * 两道闸：数量超了扔最旧的；体积超了也从最旧的扔。
 * 扔会话不扔数据——库里的人物事件还在，丢的只是一段聊天记录。
 */
export function saveSession(s: AiSession): AiSession {
  const list = readAll();
  const i = list.findIndex((x) => x.id === s.id);
  if (i >= 0) list[i] = s;
  else list.unshift(s);

  let kept = list.slice(0, MAX_SESSIONS);
  while (kept.length > 1 && JSON.stringify(kept).length > MAX_TOTAL_CHARS) {
    kept = kept.slice(0, -1);
  }
  writeAll(kept);
  return s;
}

/** 新建一个空会话（先落盘拿 id，标题等第一条消息再补） */
export function createSession(): AiSession {
  const now = new Date().toISOString();
  const s: AiSession = {
    id: newId('ais'),
    title: '新会话',
    createdAt: now,
    updatedAt: now,
    messages: [],
    items: [],
  };
  return saveSession(s);
}

export function deleteSession(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id));
}
