// 工具注册表：唯一的「能力清单」。
//
// UI 直接 import repo 函数；CLI 和 AI 都走这里。
// 新增功能时的约定：能力写在 repo 层，然后在这里声明一条 ToolDef——
// 这样 CLI 和 AI 自动就有了新能力，不用各自再接一遍。

import type { ToolDef, ToolGroup, ToolOutcome, ToolParam } from './types';
import { GROUP_LABELS } from './types';
import { PERSON_TOOLS } from './persons';
import { EVENT_TOOLS } from './events';
import { CHAT_TOOLS } from './chat';
import { COLLECTION_TOOLS } from './collections';
import { FILE_TOOLS } from './files';
import { SNAPSHOT_TOOLS } from './snapshots';
import { IO_TOOLS } from './io';
import { SYSTEM_TOOLS } from './system';
import { REMOTE_TOOLS } from './remote';

export const TOOLS: ToolDef[] = [
  ...PERSON_TOOLS,
  ...EVENT_TOOLS,
  ...CHAT_TOOLS,
  ...COLLECTION_TOOLS,
  ...FILE_TOOLS,
  ...SNAPSHOT_TOOLS,
  ...IO_TOOLS,
  ...SYSTEM_TOOLS,
  ...REMOTE_TOOLS,
];

// 启动时自检：重名会让 runTool 随机命中其中一个，必须零容忍
const seen = new Set<string>();
for (const t of TOOLS) {
  if (seen.has(t.name)) throw new Error(`工具名重复：${t.name}`);
  seen.add(t.name);
}

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function toolNames(): string[] {
  return TOOLS.map((t) => t.name);
}

export function toolsOfGroup(group: ToolGroup): ToolDef[] {
  return TOOLS.filter((t) => t.group === group);
}

/**
 * 按声明把入参转成目标类型。
 *
 * CLI 传来的永远是字符串（--rating 5），AI 传来的已经是 JSON 类型；
 * 两边都靠这一层对齐，工具内部的 run 就可以当入参是typed 的用。
 */
export function coerceArgs(tool: ToolDef, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const p of tool.params) {
    if (!(p.name in out)) continue;
    const v = out[p.name];
    if (v === undefined || v === null) continue;
    switch (p.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(v);
        if (Number.isNaN(n)) throw new Error(`参数 ${p.name} 不是数字：${String(v)}`);
        out[p.name] = n;
        break;
      }
      case 'boolean': {
        if (typeof v === 'boolean') break;
        const s = String(v).toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(s)) out[p.name] = true;
        else if (['false', '0', 'no', 'off'].includes(s)) out[p.name] = false;
        else throw new Error(`参数 ${p.name} 不是布尔值：${String(v)}`);
        break;
      }
      case 'object':
      case 'array': {
        if (typeof v !== 'string') break;
        try {
          out[p.name] = JSON.parse(v);
        } catch {
          throw new Error(`参数 ${p.name} 不是合法 JSON：${String(v).slice(0, 80)}`);
        }
        break;
      }
      default:
        if (typeof v !== 'string') out[p.name] = String(v);
    }
  }
  return out;
}

function checkRequired(tool: ToolDef, args: Record<string, unknown>): void {
  for (const p of tool.params) {
    if (!p.required) continue;
    const v = args[p.name];
    if (v === undefined || v === null || v === '') {
      throw new Error(`缺少必填参数：${p.name}（${p.desc}）`);
    }
  }
}

/**
 * 统一的工具调用入口。永不抛错——错误也包装成结果，
 * 因为 AI 循环需要把失败原因喂回模型让它自己纠正。
 */
export async function callTool(name: string, rawArgs: Record<string, unknown> = {}): Promise<ToolOutcome> {
  const tool = findTool(name);
  if (!tool) {
    return {
      ok: false,
      name,
      error: `工具不存在：${name}。可用工具：${toolNames().join(', ')}`,
    };
  }
  try {
    const args = coerceArgs(tool, rawArgs ?? {});
    checkRequired(tool, args);
    const data = await tool.run(args);
    return { ok: true, name, data: data === undefined ? { ok: true } : data };
  } catch (err) {
    return { ok: false, name, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 同步版（CLI 顶层 await 之前想先算点东西时用；绝大多数工具是同步的） */
export function callToolSync(name: string, rawArgs: Record<string, unknown> = {}): ToolOutcome {
  const tool = findTool(name);
  if (!tool) return { ok: false, name, error: `工具不存在：${name}` };
  try {
    const args = coerceArgs(tool, rawArgs ?? {});
    checkRequired(tool, args);
    const data = tool.run(args);
    if (data && typeof (data as Promise<unknown>).then === 'function') {
      throw new Error(`${name} 是异步工具，请用 callTool`);
    }
    return { ok: true, name, data: data === undefined ? { ok: true } : data };
  } catch (err) {
    return { ok: false, name, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------- 给 AI 的两种描述形式 ----------------

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required: string[];
    };
  };
}

/** OpenAI 兼容的 function calling 描述（大多数国内厂商也吃这一套） */
export function toolSchemas(): OpenAITool[] {
  return TOOLS.map((t) => {
    const properties: OpenAITool['function']['parameters']['properties'] = {};
    for (const p of t.params) {
      properties[p.name] = {
        type: p.type === 'object' ? 'object' : p.type === 'array' ? 'array' : p.type,
        description: p.desc + (p.enum ? `，可选值：${p.enum.join(' / ')}` : '') + (p.default !== undefined ? `，默认 ${JSON.stringify(p.default)}` : ''),
        ...(p.enum ? { enum: p.enum } : {}),
      };
    }
    return {
      type: 'function' as const,
      function: {
        name: t.name,
        description: `${t.title}。${t.desc}${t.mutating ? '（会修改数据，执行前会自动备份）' : ''}`,
        parameters: {
          type: 'object' as const,
          properties,
          required: t.params.filter((p) => p.required).map((p) => p.name),
        },
      },
    };
  });
}

/** 纯文本目录：不支持 function calling 的模型，就把这个塞进 system prompt */
export function toolCatalogText(): string {
  const lines: string[] = [];
  for (const g of Object.keys(GROUP_LABELS) as ToolGroup[]) {
    const list = toolsOfGroup(g);
    if (!list.length) continue;
    lines.push(`## ${GROUP_LABELS[g]}（${g}.*）`);
    for (const t of list) {
      const params = t.params.map((p) => `${p.name}${p.required ? '' : '?'}:${p.type}`).join(', ');
      lines.push(`- ${t.name}(${params}) — ${t.title}。${t.desc}${t.mutating ? ' [写库]' : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export type { ToolDef, ToolGroup, ToolOutcome, ToolParam };
