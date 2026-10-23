// core/tools 出口：工具注册表 + 宿主文件访问。
//
// 上层（CLI、AI agent、UI 里的 AI 面板）只从这里拿，
// 不要直接 import 下面的 persons.ts / events.ts 等分组文件。

export {
  TOOLS,
  findTool,
  toolNames,
  toolsOfGroup,
  coerceArgs,
  callTool,
  callToolSync,
  toolSchemas,
  toolCatalogText,
  type OpenAITool,
} from './registry';
export { GROUP_LABELS, type ToolDef, type ToolGroup, type ToolOutcome, type ToolParam } from './types';
export { setHostFs, getHostFs, requireHostFs, type HostFs } from './host';
