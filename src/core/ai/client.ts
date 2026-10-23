// 和 OpenAI 兼容接口打交道的那一层：列模型、测连通、发一次对话。
//
// 只依赖 /v1/models 与 /v1/chat/completions 两个端点——硅基流动、DeepSeek、
// Moonshot、Ollama、各家网关都实现了这两个，所以一套代码能覆盖全部。
import { getApiKey } from './models';
import {
  normalizeCaps,
  providerOf,
  type AiCapability,
  type AiMessage,
  type AiModel,
  type AiProvider,
  type AiReply,
} from './types';

export interface ListModelsOpts {
  provider: AiProvider;
  /** 覆盖默认根地址 */
  baseUrl?: string;
  /** 覆盖已存的密钥（表单里刚填还没保存时用） */
  apiKey?: string;
}

function rootOf(provider: AiProvider, baseUrl?: string): string {
  const url = (baseUrl ?? '').trim() || providerOf(provider).baseUrl;
  return url.replace(/\/+$/, '');
}

function headersFor(o: ListModelsOpts): Record<string, string> {
  const key = (o.apiKey ?? getApiKey(o.provider)).trim();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

async function call(url: string, init: RequestInit, what: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    // 浏览器把 CORS / 断网 / 混合内容都归成 TypeError，只能给一句合并的提示
    throw new Error(`${what}失败：连不上服务。检查网络，或该服务是否允许浏览器跨域访问。`);
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text) as { message?: string; error?: { message?: string } };
      detail = j.error?.message ?? j.message ?? detail;
    } catch {
      /* 非 JSON 就原文截断 */
    }
    if (res.status === 401) throw new Error(`${what}失败：密钥不对或已失效`);
    if (res.status === 404) throw new Error(`${what}失败：地址不对（${url}）`);
    if (res.status === 429) throw new Error(`${what}失败：额度或频率用尽`);
    throw new Error(`${what}失败（${res.status}）：${detail}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what}失败：返回的不是 JSON`);
  }
}

/** 远端模型，连同它自带的能力（若服务商返回了） */
export interface RemoteModel {
  id: string;
  /** 硅基流动会返回；通用 OpenAI 兼容接口不返回，留空，由用户手动勾选 */
  capabilities: AiCapability[];
}

/** 拉服务商的模型列表（含硅基流动返回的模型能力） */
export async function listRemoteModels(o: ListModelsOpts): Promise<RemoteModel[]> {
  const data = (await call(
    `${rootOf(o.provider, o.baseUrl)}/models`,
    { method: 'GET', headers: headersFor(o) },
    '读取模型列表',
  )) as {
    data?: { id?: string; model?: string; name?: string; capabilities?: unknown }[];
    models?: { name?: string; id?: string }[];
  };

  // OpenAI 风格是 data[].id，硅基流动的同款还会带 capabilities；Ollama 是 models[].name
  const fromData = (data.data ?? [])
    .map((m) => ({
      id: (m.id ?? m.model ?? m.name ?? '').trim(),
      capabilities: normalizeCaps(m.capabilities),
    }))
    .filter((r) => r.id);
  if (fromData.length) return fromData.sort((a, b) => a.id.localeCompare(b.id));

  return (data.models ?? [])
    .map((m) => ({ id: (m.name ?? m.id ?? '').trim(), capabilities: [] as AiCapability[] }))
    .filter((r) => r.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export interface ChatOpts {
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 覆盖密钥（表单测试用） */
  apiKey?: string;
  /** 生成长度上限；默认取模型的 maxTokens */
  signal?: AbortSignal;
  /** 工具描述（OpenAI function calling 格式）；给了模型就可能返回 toolCalls */
  tools?: unknown[];
  /** auto = 模型自己决定用不用工具（默认） */
  toolChoice?: 'auto' | 'none';
}

/** 模型要求调用一次工具 */
export interface ToolCall {
  id: string;
  name: string;
  /** JSON 字符串（个别厂商返回对象，已统一成字符串） */
  arguments: string;
}

/** 用某个别名（模型）发一次对话 */
export async function chat(m: AiModel, o: ChatOpts): Promise<AiReply> {
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    model: m.model,
    messages: o.messages,
    temperature: o.temperature ?? m.temperature,
    max_tokens: o.maxTokens ?? m.maxTokens,
    stream: false,
  };
  if (o.tools?.length) {
    body.tools = o.tools;
    body.tool_choice = o.toolChoice ?? 'auto';
  }
  const data = (await call(
    `${rootOf(m.provider, m.baseUrl)}/chat/completions`,
    {
      method: 'POST',
      headers: headersFor({ provider: m.provider, apiKey: o.apiKey }),
      body: JSON.stringify(body),
      signal: o.signal,
    },
    '调用模型',
  )) as {
    model?: string;
    choices?: {
      finish_reason?: string;
      message?: {
        content?: string | null;
        reasoning_content?: string;
        tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[];
      };
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error('模型没有返回内容');

  // 工具调用参数：规范是 JSON 字符串，但真有厂商给对象。统一成字符串，
  // 免得后面每个消费方都要写一遍「是字符串还是对象」的判断。
  const toolCalls: ToolCall[] = (msg.tool_calls ?? [])
    .map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.function?.name ?? '',
      arguments:
        typeof tc.function?.arguments === 'string'
          ? tc.function.arguments
          : JSON.stringify(tc.function?.arguments ?? {}),
    }))
    .filter((tc) => tc.name);

  return {
    content: msg.content ?? '',
    reasoning: msg.reasoning_content || undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    finishReason: data.choices?.[0]?.finish_reason,
    model: data.model ?? m.model,
    usage: data.usage
      ? { prompt: data.usage.prompt_tokens ?? 0, completion: data.usage.completion_tokens ?? 0 }
      : undefined,
    ms: Date.now() - t0,
  };
}

/** 测连通：问一句最短的话，能拿回内容就算通 */
export async function testModel(
  m: Pick<AiModel, 'provider' | 'baseUrl' | 'model'>,
  apiKey?: string,
): Promise<AiReply> {
  return chat(
    {
      ...(m as AiModel),
      temperature: 0,
      maxTokens: 16,
    },
    { messages: [{ role: 'user', content: '只回复两个字：收到' }], temperature: 0, maxTokens: 16, apiKey },
  );
}
