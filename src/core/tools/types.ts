// 工具注册表的类型定义。
//
// 为什么要有这一层：每一项能力（建人物、记一件事、插一条消息、拍快照……）
// 原本只以「函数」的形式存在，UI 直接 import 来用。要让 AI 也能调，
// 就得给每个能力补一份机器可读的声明：叫什么、干什么、要什么参数、会不会写库。
// 这份声明就是 ToolDef——UI 走原函数，AI / CLI 走 runTool(name, args)，
// 两条路最终落到同一个实现，不会出现「AI 能改的字段 UI 改不了」这种分叉。

/** 工具分组：目录展示、CLI 子命令前缀、AI 提示里的分类都用它 */
export type ToolGroup = 'person' | 'event' | 'chat' | 'collection' | 'file' | 'snapshot' | 'io' | 'system';

export type ToolParamType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface ToolParam {
  name: string;
  type: ToolParamType;
  /** 给模型看的参数说明 */
  desc: string;
  required?: boolean;
  default?: unknown;
  /** 候选值：CLI 拿来校验，AI 拿它补进 description */
  enum?: string[];
}

export interface ToolDef {
  /** 命名空间风格的名字，如 person.create。全局唯一 */
  name: string;
  group: ToolGroup;
  /** 给人看的一句话标题（CLI --help、目录） */
  title: string;
  /** 给模型看的说明：什么时候用它、注意事项 */
  desc: string;
  params: ToolParam[];
  /**
   * 是否写库。写库的工具：
   * - AI 每轮第一次调用前会自动拍快照（误改可整轮回退）
   * - CLI 默认也拍（--no-snapshot 可关）
   */
  mutating: boolean;
  /** 真正干活的那个函数。返回值必须可 JSON 序列化 */
  run: (args: Record<string, unknown>) => unknown;
}

export const GROUP_LABELS: Record<ToolGroup, string> = {
  person: '人物',
  event: '事件',
  chat: '聊天消息',
  collection: '事件集',
  file: '附件',
  snapshot: '快照',
  io: '导入导出 / 分享',
  system: '系统',
};

/** runTool 的统一返回包装：AI 循环要把结果喂回模型，异常也必须是数据 */
export type ToolOutcome =
  | { ok: true; name: string; data: unknown }
  | { ok: false; name: string; error: string };
