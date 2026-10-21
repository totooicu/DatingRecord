// 设置页的二级目录。
//
// 原来七个 Section 平铺在一屏里，找个「归档的人物」要滚很久；
// 拆成目录 + 子页后，手机上一屏只有六条入口，宽屏左目录右内容。

export type SettingsKey = 'backup' | 'attrs' | 'people' | 'archive' | 'files' | 'overview' | 'sample';

export interface SettingsEntry {
  key: SettingsKey;
  title: string;
  hint: string;
}

export const SETTINGS_ENTRIES: SettingsEntry[] = [
  { key: 'backup', title: '备份与恢复', hint: '导入 / 导出 .drp.json' },
  { key: 'attrs', title: '属性字典', hint: '自定义字段的类型与分组' },
  { key: 'people', title: '人物整理', hint: '重复人物合并' },
  { key: 'archive', title: '归档与回收', hint: '统一恢复 / 彻底删除' },
  { key: 'files', title: '文件', hint: '正文引用的图片与附件' },
  { key: 'overview', title: '库概览', hint: '数量、体积、操作日志' },
  { key: 'sample', title: '示例数据与重置', hint: '载入示例、清空全部' },
];

/** 宽屏没有「目录页」这一步，默认落在第一项 */
export const DEFAULT_SETTINGS_KEY: SettingsKey = 'backup';
