// AI 助手：多轮「思考 → 调工具 → 看结果 → 再思考」的 agent 循环。
//
// 和「一问一答」的区别：模型可以连续调用多个工具，每次调用的结果会喂回去
// 给它看，它再决定下一步。查一下、建一个、再查一遍确认，都在同一轮里完成。
//
// 安全设计：
//   · 每轮第一次调**写库**工具前，自动拍一份整库快照（source='ai'）。
//     模型一顿操作之后整体不对，用户一键就能回到它动手之前——
//     这比「相信模型不会写错」可靠得多。
//   · 轮数有上限（默认 8），防止模型陷入「调用→报错→再调用」的死循环烧钱。
//   · 单个工具结果超长会截断，避免把上下文撑爆。

import { chat, type ToolCall } from './client';
import type { AiMessage, AiModel } from './types';
import { callTool, findTool, toolSchemas, toolCatalogText } from '../tools';
import { createSnapshot } from '../snapshots';

/** 对话里的一条。tool 角色是喂回去的工具结果 */
export type AgentMessage =
  | {
      role: 'system' | 'user';
      content: string;
      /** 随这条消息一起发的图片（data URL）。只有 user 会有 */
      images?: { name: string; dataUrl: string }[];
    }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export type AgentEvent =
  | { type: 'round'; n: number }
  | { type: 'snapshot'; id: string | null }
  | { type: 'tool_start'; name: string; args: Record<string, unknown> }
  | { type: 'tool_end'; name: string; ok: boolean; preview: string }
  | { type: 'error'; message: string };

export interface AgentOpts {
  model: AiModel;
  /** 截止到目前的对话（最后一条应是 user） */
  history: AgentMessage[];
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
  /** 最多几轮模型↔工具往返，默认 8 */
  maxRounds?: number;
}

export interface AgentTurnResult {
  /** 追加了 assistant / tool 消息之后的完整对话 */
  messages: AgentMessage[];
  /** 本轮自动拍的快照 id（没写库则为 null）——UI 拿它提供「回退本轮」 */
  snapshotId: string | null;
  usedTools: string[];
  rounds: number;
  /** 被中止 / 触顶时没有最终回复 */
  aborted: boolean;
  error?: string;
}

/** 工具结果塞回上下文前的长度上限 */
const MAX_TOOL_CHARS = 6000;

export function agentSystemPrompt(): string {
  return [
    '你是 DatingRecord 的内置助手。DatingRecord 是本地优先的个人关系档案应用，数据只存在用户自己的设备上。',
    '库里有四类对象：',
    '· 人物（person）：姓名、别名、标签、一组动态属性（有哪些属性键见 person.attrDefs）',
    '· 事件（event）：一次经历，有类型 kind、时间、地点、参与者、正文、评分/花费等指标',
    '· 聊天消息：事件可以按「聊天形式」呈现，由多条消息/旁白组成（chat.* 工具）',
    '· 事件集（collection）：树状分组，也可以是按规则自动匹配事件的智能集合',
    '',
    '你有一套工具可以读写这些数据。工作规则：',
    '1. 不确定 id 就先查（person.list / event.list / collection.tree），绝不凭空编 id。',
    '2. 动手改数据前，先用一句话说清你要做什么——用户看得到你的工具调用过程。',
    '3. 删除优先用软删除（person.archive / event.delete / collection.delete），',
    '   物理删除（hardDelete / purge）只用于清理回收站和合并留下的墓碑。',
    '4. 系统会在本轮第一次写库前自动拍快照，用户不满意可以整轮回退，你不必反复确认。',
    '5. 工具报错时，按错误信息修正参数重试；同样的错误不要重复犯。',
    '6. 用中文回答，简洁、口语化，像同事一样说话；不要大段复述 JSON 或工具输出。',
    '',
    '可用工具：',
    toolCatalogText(),
  ].join('\n');
}

function toWire(msgs: AgentMessage[]): AiMessage[] {
  return msgs.map((m) => {
    if (m.role === 'tool') {
      // tool 角色不在 AiMessage 的联合类型里，但它就是 OpenAI 协议的一部分
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content } as unknown as AiMessage;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      } as unknown as AiMessage;
    }
    // 带图的消息走多模态分段：文字和图片各自一段，顺序保持「先文字后图片」
    if (m.role === 'user' && m.images?.length) {
      return {
        role: 'user',
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...m.images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
        ],
      } as unknown as AiMessage;
    }
    return { role: m.role, content: m.content };
  });
}

function preview(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

function truncateResult(json: string): string {
  if (json.length <= MAX_TOOL_CHARS) return json;
  return `${json.slice(0, MAX_TOOL_CHARS)}…（结果过长已截断，原始长度 ${json.length} 字符）`;
}

/** 跑一轮：模型可以调多次工具，直到它给出最终文本回复 */
export async function runAgentTurn(opts: AgentOpts): Promise<AgentTurnResult> {
  const { model, signal, onEvent } = opts;
  const maxRounds = opts.maxRounds ?? 8;
  const messages: AgentMessage[] = [...opts.history];
  const usedTools: string[] = [];
  let snapshotId: string | null = null;
  let rounds = 0;
  let aborted = false;

  const tools = toolSchemas();

  for (;;) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }
    rounds += 1;
    onEvent?.({ type: 'round', n: rounds });
    if (rounds > maxRounds) {
      messages.push({
        role: 'assistant',
        content: `（已连续调用 ${maxRounds} 轮工具，先停在这里。可以把上一步的结果告诉我，我们继续。）`,
      });
      break;
    }

    let reply;
    try {
      reply = await chat(model, { messages: toWire(messages), tools, signal });
    } catch (err) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }
      const message = err instanceof Error ? err.message : String(err);
      onEvent?.({ type: 'error', message });
      return { messages, snapshotId, usedTools, rounds, aborted: false, error: message };
    }

    if (reply.toolCalls?.length) {
      messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls });

      for (const tc of reply.toolCalls) {
        if (signal?.aborted) {
          aborted = true;
          break;
        }
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(tc.arguments || '{}') as unknown;
          args = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
        } catch {
          args = { _raw: tc.arguments };
        }
        onEvent?.({ type: 'tool_start', name: tc.name, args });

        // 本轮第一次写库前自动备份：一个快照覆盖整轮，回退时一步到位
        const def = findTool(tc.name);
        if (def?.mutating && snapshotId === null) {
          try {
            const snap = await createSnapshot('ai', `AI 操作前自动备份（${tc.name}）`);
            snapshotId = snap?.id ?? null;
          } catch {
            snapshotId = null; // 备份失败不阻断操作，但 UI 上就看不到回退入口
          }
          onEvent?.({ type: 'snapshot', id: snapshotId });
        }

        const out = await callTool(tc.name, args);
        usedTools.push(tc.name);
        const text = truncateResult(JSON.stringify(out));
        onEvent?.({ type: 'tool_end', name: tc.name, ok: out.ok, preview: preview(text) });
        messages.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: text });
      }
      if (aborted) break;
      continue;
    }

    messages.push({ role: 'assistant', content: reply.content });
    return { messages, snapshotId, usedTools, rounds, aborted: false };
  }

  return { messages, snapshotId, usedTools, rounds, aborted: true };
}
