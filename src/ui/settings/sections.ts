// 设置页的二级目录。
//
// 原来七个 Section 平铺在一屏里，找个「归档的人物」要滚很久；拆成目录 + 子页后
// 手机上每屏只有几条入口，宽屏左目录右内容。
//
// 后来又按「做一件事」把相邻入口合成了几组（安全与隐私 / 人物与属性 / 数据与统计）：
//   · 应用锁 + 本地库加密 + 隐私模式本来是同一件事的三个面（谁拦、拦什么、藏什么），
//     分成三个入口时用户得来回跳才知道自己开没开；
//   · 属性字典 + 属性模板是「字段长什么样」和「一组字段打包」，拆开反而找不到；
//   · 库概览 + 示例数据与重置都属于「这个库整体」。
// 合并只动「进哪一页」，各组内部仍是独立卡片，状态互不影响。

export type SettingsKey =
  | 'backup'
  | 'sync'
  | 'ai'
  | 'security'
  | 'people'
  | 'data'
  | 'attrs'
  | 'merge'
  | 'archive'
  | 'files'
  | 'lab';

/** 分组只用于目录渲染时划线分区，不影响路由 */
export type SettingsGroup = 'general' | 'security' | 'people' | 'data';

export interface SettingsEntry {
  key: SettingsKey;
  title: string;
  hint: string;
  group: SettingsGroup;
}

export const SETTINGS_ENTRIES: SettingsEntry[] = [
  { key: 'backup', title: '备份与恢复', hint: '导入 / 导出 .drp.json', group: 'general' },
  { key: 'sync', title: '坚果云备份', hint: '只传变化分片的增量同步', group: 'general' },
  { key: 'ai', title: 'AI 模型', hint: '别名、服务商、密钥与连通测试', group: 'general' },
  { key: 'security', title: '隐私与安全', hint: '应用锁、本地库加密、隐私模式', group: 'security' },
  { key: 'people', title: '人物与属性', hint: '属性字典、属性模板、重复合并', group: 'people' },
  { key: 'archive', title: '归档与回收', hint: '统一恢复 / 彻底删除', group: 'people' },
  { key: 'files', title: '文件', hint: '正文引用的图片与附件', group: 'people' },
  { key: 'data', title: '数据与统计', hint: '库概览、示例数据与重置', group: 'data' },
  { key: 'lab', title: '功能体验', hint: '边缘分割等独立小工具', group: 'data' },
];

export const GROUP_TITLES: Record<SettingsGroup, string> = {
  general: '通用',
  security: '安全',
  people: '人物',
  data: '数据',
};

/** 旧入口 → 新入口。旧的深链接、书签、肌肉记忆都能落到该去的那一页 */
export const LEGACY_KEYS: Record<string, SettingsKey> = {
  lock: 'security',
  enc: 'security',
  templates: 'attrs',
  overview: 'data',
  sample: 'data',
};

/** 宽屏没有「目录页」这一步，默认落在第一项 */
export const DEFAULT_SETTINGS_KEY: SettingsKey = 'backup';

export function isSettingsKey(k: string): k is SettingsKey {
  return SETTINGS_ENTRIES.some((e) => e.key === k);
}

/** 接受新 key 或旧 key，返回可用的子页 key；都不认就返回 null */
export function resolveSettingsKey(k: string | null): SettingsKey | null {
  if (!k) return null;
  if (isSettingsKey(k)) return k;
  return LEGACY_KEYS[k] ?? null;
}
