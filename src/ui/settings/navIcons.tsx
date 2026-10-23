// 设置目录的入口图标：20px 线性 SVG，跟随 currentColor。
//
// 和 rowIcons 一样用内联 SVG 而不是 emoji——emoji 在部分安卓机上会渲染成
// 空心方块，也没法跟随主题色。
import type { ReactNode } from 'react';
import type { SettingsGroup, SettingsKey } from './sections';

/** 图标 key = 页面 key + 分组 key + 只在这份文件里用到的几个（合并页里的各块） */
export type NavIconKey =
  | SettingsKey
  | SettingsGroup
  | 'lock'
  | 'enc'
  | 'privacy'
  | 'templates'
  | 'overview'
  | 'sample';

const ICON = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const wrap = (children: ReactNode) => <svg {...ICON}>{children}</svg>;

export function SettingsIcon({ k }: { k: NavIconKey }) {
  switch (k) {
    // 备份与恢复：箱子里装着一份存档
    case 'backup':
      return wrap(
        <>
          <path d="M3.6 7.6h16.8v10.6a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8z" />
          <path d="M3.6 7.6 5.6 4.4h12.8l2 3.2" />
          <path d="M9.4 12h5.2" />
        </>,
      );
    // 坚果云备份：云 + 上下箭头
    case 'sync':
      return wrap(
        <>
          <path d="M7.4 17.6h9.3a3.3 3.3 0 0 0 .4-6.6 4.9 4.9 0 0 0-9.4-1.2 3.9 3.9 0 0 0-.3 7.8" />
          <path d="M12 9.6v6.2" />
          <path d="M9.9 11.6 12 9.5l2.1 2.1" />
        </>,
      );
    // AI 模型：对话气泡 + 星
    case 'ai':
      return wrap(
        <>
          <path d="M4.2 6.4h11.2v7.4H9.6l-3.6 2.6v-2.6H4.2z" />
          <path d="M18.4 11.4h1.4v7.2h-1.8l-2.6 2v-2h-4" />
        </>,
      );
    // 隐私与安全（分组）：盾牌
    case 'security':
      return wrap(
        <>
          <path d="M12 3.2 19 6v5.4c0 4.2-2.9 7.4-7 9.4-4.1-2-7-5.2-7-9.4V6z" />
          <path d="M9.4 12.2l1.9 1.9 3.5-3.6" />
        </>,
      );
    // 应用锁：挂锁
    case 'lock':
      return wrap(
        <>
          <rect x="4.8" y="10.4" width="14.4" height="9.6" rx="2.2" />
          <path d="M8.4 10.4V8a3.6 3.6 0 0 1 7.2 0v2.4" />
          <path d="M12 14.4v2.2" />
        </>,
      );
    // 本地库加密：钥匙
    case 'enc':
      return wrap(
        <>
          <circle cx="8.4" cy="8.4" r="3.6" />
          <path d="M11 11l8.2 8.2" />
          <path d="M16.2 16.2l-1.8 1.8 1.8 1.8" />
        </>,
      );
    // 隐私模式：眼睛
    case 'privacy':
      return wrap(
        <>
          <path d="M2.8 12s3.6-6 9.2-6 9.2 6 9.2 6-3.6 6-9.2 6-9.2-6-9.2-6z" />
          <circle cx="12" cy="12" r="2.6" />
        </>,
      );
    // 人物与属性（分组）：一列带标签的条目
    case 'people':
      return wrap(
        <>
          <circle cx="9" cy="8.2" r="3" />
          <path d="M3.8 19.4c0-2.9 2.4-4.6 5.2-4.6s5.2 1.7 5.2 4.6" />
          <path d="M17 7.4h3.4M17 11h3.4M17 14.6h2.4" />
        </>,
      );
    // 属性字典：表格
    case 'attrs':
      return wrap(
        <>
          <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="1.8" />
          <path d="M3.6 9.4h16.8M9.6 9.4v10M15.4 9.4v10" />
        </>,
      );
    // 属性模板：几层叠起来的卡片
    case 'templates':
      return wrap(
        <>
          <rect x="6.4" y="3.8" width="11.2" height="7" rx="1.6" />
          <path d="M4.4 13.4h15.2v4.4a1.6 1.6 0 0 1-1.6 1.6H6a1.6 1.6 0 0 1-1.6-1.6z" />
          <path d="M9.2 16.6h5.6" />
        </>,
      );
    // 人物整理：两条记录合并成一条
    case 'merge':
      return wrap(
        <>
          <path d="M4.4 5.4h4.2l4.6 6.6h6.4" />
          <path d="M4.4 18.6h4.2l4.6-6.6" />
          <path d="M16.4 9l3 3-3 3" />
        </>,
      );
    // 归档与回收：归档盒
    case 'archive':
      return wrap(
        <>
          <rect x="3.6" y="4.6" width="16.8" height="4.8" rx="1.4" />
          <path d="M5.2 9.4v8.8a1.8 1.8 0 0 0 1.8 1.8h10a1.8 1.8 0 0 0 1.8-1.8V9.4" />
          <path d="M9.6 13.4h4.8" />
        </>,
      );
    // 文件：文档角标
    case 'files':
      return wrap(
        <>
          <path d="M6 3.6h7.4L19 9.2v11.2H6z" />
          <path d="M13.2 3.8v5.6h5.4" />
          <path d="M9.2 13h6.4M9.2 16.6h4.4" />
        </>,
      );
    // 数据与统计（分组）：柱状图
    case 'data':
      return wrap(
        <>
          <path d="M4.4 19.4V4.6" />
          <path d="M4.4 19.4h15.2" />
          <path d="M8.4 19.4v-5.2M12.4 19.4V9.4M16.4 19.4v-7.2" />
        </>,
      );
    // 功能体验：图片框 + 齿轮
    case 'lab':
      return wrap(
        <>
          <rect x="3.4" y="4.6" width="13.6" height="11.2" rx="1.8" />
          <path d="M3.4 15.4h13.6" />
          <circle cx="9" cy="8.4" r="1.8" />
          <path d="M17.6 8.6v3.2M15.9 10.2h3.4" />
        </>,
      );
    // 库概览：仪表盘
    case 'overview':
      return wrap(
        <>
          <circle cx="12" cy="12" r="8.2" />
          <path d="M12 12l3.4-3.4" />
          <path d="M12 15.6h.01" />
        </>,
      );
    // 示例数据与重置：循环箭头
    case 'sample':
      return wrap(
        <>
          <path d="M4.6 12a7.4 7.4 0 0 1 12.6-5.2l2 2" />
          <path d="M19.4 4.6v4.8h-4.8" />
          <path d="M19.4 12a7.4 7.4 0 0 1-12.6 5.2l-2-2" />
          <path d="M4.6 19.4v-4.8h4.8" />
        </>,
      );
  }
}

/** 分组标题旁的小图标 */
export function GroupIcon({ g }: { g: SettingsGroup }) {
  switch (g) {
    case 'security':
      return <SettingsIcon k="security" />;
    case 'people':
      return <SettingsIcon k="people" />;
    case 'data':
      return <SettingsIcon k="data" />;
    default:
      return wrap(
        <>
          <rect x="4" y="4.4" width="16" height="15.2" rx="2" />
          <path d="M8.4 9.4h7.2M8.4 13h7.2M8.4 16.6h4" />
        </>,
      );
  }
}
