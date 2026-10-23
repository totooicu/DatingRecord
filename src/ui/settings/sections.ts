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
  | 'backupData'
  | 'sync'
  | 'share'
  | 'security'
  | 'people'
  | 'data'
  | 'attrs'
  | 'merge'
  | 'archive'
  | 'files'
  | 'lab'
  | 'labAi'
  | 'labEdge'
  | 'labChat'
  | 'labDraft';

/** 分组只用于目录渲染时划线分区，不影响路由 */
export type SettingsGroup = 'general' | 'security' | 'people' | 'data' | 'trial';

export interface SettingsEntry {
  key: SettingsKey;
  title: string;
  hint: string;
  group: SettingsGroup;
}

export const SETTINGS_ENTRIES: SettingsEntry[] = [
  // 「备份与分享」是一个入口页：数据备份 / 坚果云备份 / 分享 各占一页。
  // 三者都是「把数据搬出去或搬进来」，但担子完全不同，混在一屏会互相挤占。
  { key: 'backup', title: '备份与分享', hint: '备份 · 同步 · 分享', group: 'general' },
  { key: 'backupData', title: '数据备份', hint: '导入 / 导出 .drp.zip', group: 'general' },
  { key: 'sync', title: '坚果云备份', hint: '只传变化分片的增量同步', group: 'general' },
  { key: 'share', title: '分享', hint: '向导导出 / 导入 .drshare.zip', group: 'general' },
  { key: 'security', title: '隐私与安全', hint: '应用锁、本地库加密、隐私模式', group: 'security' },
  { key: 'people', title: '人物与属性', hint: '属性字典、属性模板、重复合并', group: 'people' },
  { key: 'archive', title: '归档与回收', hint: '统一恢复 / 彻底删除', group: 'people' },
  { key: 'files', title: '文件', hint: '正文引用的图片与附件', group: 'people' },
  { key: 'data', title: '数据与统计', hint: '库概览、示例数据与重置', group: 'data' },
  // 功能体验单独成组（trial）：lab 是这一组的入口页，labAi / labEdge / labDraft 是它的子页。
  // 以前 AI 对话和边缘分割叠在同一个 lab 页里，聊天区被挤到 44vh。
  { key: 'lab', title: '功能体验', hint: '新功能试用区', group: 'trial' },
  { key: 'labAi', title: 'AI 对话', hint: '能思考、能动手的助手', group: 'trial' },
  { key: 'labEdge', title: '边缘分割', hint: '从一张图里切出多个元素', group: 'trial' },
  { key: 'labChat', title: '聊天提取', hint: '截图 → 聊天事件', group: 'trial' },
  // 未完成：还没提交的表单先留一份草稿，防刷新 / 误关导致白写
  { key: 'labDraft', title: '未完成的记录', hint: '未完成 · 草稿自动留底', group: 'trial' },
];

export const GROUP_TITLES: Record<SettingsGroup, string> = {
  general: '通用',
  security: '安全',
  people: '人物',
  data: '数据',
  trial: '功能体验',
};

/**
 * 入口页 → 它的子页。
 *
 * 只影响目录怎么画：子页不出现在目录里，点入口页先进入口页（那里列着子页），
 * 在子页里时，目录上亮的是入口页那一行。路由本身还是平铺的 SettingsKey。
 *
 * 加新子页只需在 SETTINGS_ENTRIES 里加一条、再挂到这里。
 */
export const SUB_PAGES: Partial<Record<SettingsKey, SettingsKey[]>> = {
  lab: ['labAi', 'labEdge', 'labChat', 'labDraft'],
  backup: ['backupData', 'sync', 'share'],
};

/** 这个 key 是不是某个入口页的子页 */
export function parentOf(k: SettingsKey): SettingsKey | null {
  for (const [parent, subs] of Object.entries(SUB_PAGES)) {
    if ((subs as SettingsKey[]).includes(k)) return parent as SettingsKey;
  }
  return null;
}

/** 旧入口 → 新入口。旧的深链接、书签、肌肉记忆都能落到该去的那一页 */
export const LEGACY_KEYS: Record<string, SettingsKey> = {
  lock: 'security',
  enc: 'security',
  templates: 'attrs',
  overview: 'data',
  sample: 'data',
  // 顶级「AI 模型」入口已并入「功能体验 → AI 对话」页的「模型」标签
  ai: 'labAi',
};

/** 某个 key 在目录里的标题；子页也有标题，用来拼「← 返回 xxx」 */
export function titleOf(k: SettingsKey): string {
  return SETTINGS_ENTRIES.find((e) => e.key === k)?.title ?? '';
}

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
