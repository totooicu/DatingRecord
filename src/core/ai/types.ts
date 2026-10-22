// AI 模型的类型定义。

// 注意：union 里保留了 'custom' 只是为了兼容历史数据（早期版本把自填地址存成
// provider='custom'）。providerOf 会把 'custom' 映射成 'openai'，UI 也不再出现
// 这个选项——「OpenAI 兼容 / 第三方端点」本质上就是「自定义根地址」，二者合一。
export type AiProvider = 'siliconflow' | 'openai' | 'ollama' | 'custom';

export interface AiProviderMeta {
  key: AiProvider;
  label: string;
  /** 默认 API 根，不带结尾斜杠 */
  baseUrl: string;
  /** 是否要 API Key（本地 ollama 不需要） */
  needsKey: boolean;
  /** 根地址是否可改：硅基流动固定，Ollama / OpenAI 兼容都要让用户填自己的地址 */
  baseEditable: boolean;
  hint: string;
}

export const AI_PROVIDERS: AiProviderMeta[] = [
  {
    key: 'siliconflow',
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    needsKey: true,
    baseEditable: false,
    hint: '国内直连，模型多、按量计费便宜。密钥在「API 密钥」页建。读取模型列表会自动带出每个模型的能力。',
  },
  {
    key: 'openai',
    label: 'OpenAI 兼容 / 第三方端点',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    baseEditable: true,
    hint:
      '任何兼容 /v1/chat/completions 的服务都填这里（OpenAI、DeepSeek、Moonshot、OpenRouter、自建网关）——把根地址改成对应服务即可。',
  },
  {
    key: 'ollama',
    label: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    baseEditable: true,
    hint: '跑在自己机器上，不联网、不花钱，但要先 ollama serve。地址默认 localhost，可改成远程 / 隧道地址。',
  },
];

export function providerOf(key: string): AiProviderMeta {
  if (key === 'custom') return AI_PROVIDERS[1]; // 历史数据：自定义 == OpenAI 兼容
  return AI_PROVIDERS.find((p) => p.key === key) ?? AI_PROVIDERS[0];
}

/**
 * 把服务商返回的 capabilities 字符串数组，映射成我们的 AiCapability 枚举。
 * 硅基流动的 /v1/models 会返回每个模型的 capabilities（text/image/video/audio/…），
 * 通用 OpenAI 兼容接口只回 id、不回能力，所以只能拿到空数组（由用户手动勾选）。
 */
export function normalizeCaps(raw: unknown): AiCapability[] {
  // 各家的字段命名不一：OpenAI/硅基流动常是 text/image/video/audio，
  // OpenRouter 用 vision 表示视觉、speech 表示语音。统一映射到我们的枚举。
  const MAP: Record<string, AiCapability> = {
    text: 'text',
    image: 'image',
    vision: 'image',
    visual: 'image',
    video: 'video',
    audio: 'audio',
    speech: 'audio',
    file: 'file',
    document: 'file',
  };
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => MAP[String(r).toLowerCase()]).filter((x): x is AiCapability => x !== undefined);
}

/** 模型能干的事：不同功能按需挑有对应能力的模型 */
export type AiCapability = 'text' | 'image' | 'video' | 'audio' | 'file';

export const AI_CAPABILITIES: { key: AiCapability; label: string }[] = [
  { key: 'text', label: '文本' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'file', label: '文件' },
];

/** 一条「可以按别名调用」的模型配置 */
export interface AiModel {
  id: string;
  /** 别名：调用时选的就是它 */
  alias: string;
  provider: AiProvider;
  /** 自定义服务商时填的根地址；已知服务商留空，用该服务商默认值 */
  baseUrl: string;
  /** 服务商标的模型名，如 Qwen/Qwen2.5-7B-Instruct */
  model: string;
  note: string;
  temperature: number;
  maxTokens: number;
  /** 能力标签：文本 / 图片 / 视频 / 音频 / 文件 */
  capabilities: AiCapability[];
  isDefault: boolean;
  deviceId: string;
  rev: number;
  hlc: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiReply {
  content: string;
  /** 推理过程（部分模型会单独返回 reasoning_content） */
  reasoning?: string;
  model: string;
  usage?: { prompt: number; completion: number };
  ms: number;
}
