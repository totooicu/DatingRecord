// AI 助手：多轮「思考 → 调工具 → 看结果 → 再思考」的 agent 循环。
//
// 和「一问一答」的区别：模型可以连续调用多个工具，每次调用的结果会喂回去
// 给它看，它再决定下一步。查一下、建一个、再查一遍确认，都在同一轮里完成。
//
// 安全设计：
//   · 每轮第一次调**写库**工具前，自动拍一份整库快照（source='ai'）。
//     模型一顿操作之后整体不对，用户一键就能回到它动手之前——
//     这比「相信模型不会写错」可靠得多。轮次一结束（正常收尾 / 报错 /
//     被中止都算），这一轮具体调了什么会翻译成人话回写进快照元数据，
//     快照列表因此能概括每份备份对应哪次操作，点开还能逐条看。
//   · 轮数有上限（默认 8），防止模型陷入「调用→报错→再调用」的死循环烧钱。
//   · 单个工具结果超长会截断，避免把上下文撑爆。

import { chat, type ToolCall } from './client';
import type { AiMessage, AiModel } from './types';
import { callTool, findTool, toolSchemas, toolCatalogText } from '../tools';
import { createSnapshot, patchSnapshotOps, describeOp, summarizeOps, type SnapOp, type SnapTarget } from '../snapshots';

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
  /** 最多几轮模型↔工具往返，默认 20（复杂任务建人+记事件+整理常常超 8 轮） */
  maxRounds?: number;
  /** 复用上一轮的快照 id：连续对话里，后续写操作归到同一条成果，不另拍新快照 */
  resumeSnapshotId?: string | null;
}

export interface AgentTurnResult {
  /** 追加了 assistant / tool 消息之后的完整对话 */
  messages: AgentMessage[];
  /** 本轮自动拍的快照 id（没写库则为 null）——UI 拿它提供「回退本轮」 */
  snapshotId: string | null;
  usedTools: string[];
  /** 本轮每次工具调用的人话记录，回写进快照元数据，也供 UI 展示 */
  ops: SnapOp[];
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

/**
 * 从工具结果里取出「做成了什么」。
 *
 * 新建类返回可跳转 target；删除类在删前把对象关键内容存进 target.snapshot，
 * 对象软删后点开仍能看到正文、时间、参与人，不用先恢复。
 */
function targetsOf(tool: string, args: Record<string, unknown>, data: unknown): SnapTarget[] {
  const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const id = s(row?.id);
  if (!id) return [];

  if (tool === 'person.create') {
    const name = s(row?.displayName) || s(args.displayName);
    return name ? [{ kind: 'person', id, name }] : [];
  }
  if (tool === 'event.create') {
    const name = s(row?.title) || s(args.title);
    return name ? [{ kind: 'event', id, name }] : [];
  }
  if (tool === 'collection.create') {
    const name = s(row?.name) || s(args.name);
    return name ? [{ kind: 'collection', id, name }] : [];
  }

  // 删除/归档类：把被删对象的关键内容也存下来，事后核对不用先恢复
  if (tool === 'person.archive' || tool === 'person.hardDelete') {
    const name = s(row?.displayName);
    return name ? [{ kind: 'person', id, name }] : [];
  }
  if (tool === 'event.delete' || tool === 'event.purge') {
    const ev = row?.event && typeof row.event === 'object' ? (row.event as Record<string, unknown>) : null;
    const name = s(ev?.title) || s(row?.title);
    if (!name) return [];
    const content = s(ev?.content);
    const placeName = s(ev?.place && typeof ev.place === 'object' ? (ev.place as Record<string, unknown>).name : '');
    const participants = Array.isArray(ev?.participants)
      ? (ev.participants as Record<string, unknown>[])
          .map((p) => s(p.displayName) || s(p.name))
          .filter(Boolean)
      : [];
    const timeLabel = ev?.startTs
      ? new Date(Number(ev.startTs)).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    return [{
      kind: 'event',
      id,
      name,
      snapshot: {
        ...(content ? { content } : {}),
        ...(placeName ? { placeName } : {}),
        ...(participants.length ? { personNames: participants } : {}),
        ...(timeLabel ? { timeLabel } : {}),
      },
    }];
  }
  if (tool === 'collection.delete') {
    const name = s(row?.name);
    return name ? [{ kind: 'collection', id, name }] : [];
  }
  return [];
}

/** 跑一轮：模型可以调多次工具，直到它给出最终文本回复 */
export async function runAgentTurn(opts: AgentOpts): Promise<AgentTurnResult> {
  const { model, signal, onEvent } = opts;
  const maxRounds = opts.maxRounds ?? 20;
  const messages: AgentMessage[] = [...opts.history];
  const usedTools: string[] = [];
  const ops: SnapOp[] = [];
  let snapshotId = opts.resumeSnapshotId ?? null;
  let rounds = 0;
  let aborted = false;

  const tools = toolSchemas();

  try {
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
        return { messages, snapshotId, usedTools, ops, rounds, aborted: false, error: message };
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
          const data = out.ok ? out.data : undefined;
          // 只读工具（event.list / event.get / deletedList 等）是 AI 的思考过程，
          // 不进成果列表——成果只列真正动了数据的操作，失败的写操作同样记。
          if (def?.mutating) {
            const targets = out.ok ? targetsOf(tc.name, args, data) : [];
            ops.push({
              tool: tc.name,
              text: describeOp(tc.name, args, out.ok, data),
              ok: out.ok,
              ...(targets.length ? { targets } : {}),
              ...(out.ok ? {} : { err: out.error.slice(0, 200) }),
              at: new Date().toISOString(),
            });
          }
          onEvent?.({ type: 'tool_end', name: tc.name, ok: out.ok, preview: preview(text) });
          messages.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: text });
        }
        if (aborted) break;
        continue;
      }

      messages.push({ role: 'assistant', content: reply.content });
      return { messages, snapshotId, usedTools, ops, rounds, aborted: false };
    }
  } finally {
    // 快照是动手**之前**拍的，拍的时候还不知道这一轮要干什么，
    // 所以「做了什么」只能等轮次结束（正常收尾 / 报错 / 被中止）再回写。
    // 只改元数据，不动字节——字节是恢复用的，必须保持原样。
    if (snapshotId && ops.length) {
      patchSnapshotOps(snapshotId, ops, summarizeOps(ops));
      // 对比快照和当前库，得出增删改分组——比 ops 列表更直观
      try {
        const { diffSnapshot } = await import('../snapshots/diff');
        const { patchSnapshotDiff } = await import('../snapshots');
        const d = await diffSnapshot(snapshotId);
        if (d && (d.created.length || d.updated.length || d.deleted.length)) {
          patchSnapshotDiff(snapshotId, d);
        }
      } catch { /* diff 失败不影响主流程 */ }
    }
  }

  return { messages, snapshotId, usedTools, ops, rounds, aborted: true };
}
