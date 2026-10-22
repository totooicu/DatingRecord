// AI 模型的类型定义。

export type AiProvider = 'siliconflow' | 'openai' | 'ollama' | 'custom';

export interface AiProviderMeta {
  key: AiProvider;
  label: string;
  /** 默认 API 根，不带结尾斜杠 */
  baseUrl: string;
  /** 是否要 API Key（本地 ollama 不需要） */
  needsKey: boolean;
  hint: string;
}

export const AI_PROVIDERS: AiProviderMeta[] = [
  {
    key: 'siliconflow',
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    needsKey: true,
    hint: '国内直连，模型多、按量计费便宜。密钥在「API 密钥」页建。',
  },
  {
    key: 'openai',
    label: 'OpenAI 兼容',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    hint: '任何兼容 /v1/chat/completions 的服务都能填这里（DeepSeek、Moonshot、自建网关）。',
  },
  {
    key: 'ollama',
    label: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    hint: '跑在自己机器上，不联网、不花钱，但要先 ollama serve。',
  },
  {
    key: 'custom',
    label: '自定义',
    baseUrl: '',
    needsKey: true,
    hint: '完全自己填根地址，路径按 <根地址>/chat/completions 拼。',
  },
];

export function providerOf(key: string): AiProviderMeta {
  return AI_PROVIDERS.find((p) => p.key === key) ?? AI_PROVIDERS[0];
}

/** 一条「可以按别名调用」的模型配置 */
export interface AiModel {
  id: string;
  /** 别名：调用时选的就是它 */
  alias: string;
  provider: AiProvider;
  /** 覆盖该 provider 的默认根地址；空则用默认 */
  baseUrl: string;
  /** 服务商标的模型名，如 Qwen/Qwen2.5-7B-Instruct */
  model: string;
  note: string;
  temperature: number;
  maxTokens: number;
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
