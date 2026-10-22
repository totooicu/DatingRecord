// 事件集与成员

export type CollectionKind = 'root' | 'timeline' | 'arc' | 'topic' | 'project' | 'smart';

/**
 * 智能集合的匹配规则（F-C04）。
 *
 * 刻意做成 EventFilter 的子集：查询时直接翻译成 listEvents 的入参，
 * 动态求值、不落成员表——新事件满足条件自动出现，删了事件自动消失。
 */
export interface SmartRule {
  keyword?: string;
  tag?: string;
  kind?: string;
  personId?: string;
  minRating?: number;
  /** 最近 N 天；不设 = 不限时间 */
  withinDays?: number;
}

/**
 * 事件集图标（F-C08）。
 *
 * 四种类型共用一套渲染（见 ui/collections/CollectionIcon.tsx），
 * 只是来源不同：
 *   text  单文字    任意 1 个字符（汉字、符号、emoji 都行）
 *   alpha 双字母    强制 2 个字符，字母类图标（AB / 生日 → 生诞 这类）
 *   svg   矢量图    二进制存 IndexedDB，元数据在 attachments，正文/文件库都能看到
 *   image 位图      同上，按缩略图显示
 *
 * fg / bg 是前景与背景色（CSS 颜色串）；图片只允许 bg（垫在透明图后面）。
 * 文件类图标存的是**文件 id**，渲染时用 urlForFile(id) 取 objectURL——
 * 引用名（storedId）会随内容 hash 变化，id 才是稳定主键。
 */
export type CollectionIconType = 'text' | 'alpha' | 'svg' | 'image';

export interface CollectionIcon {
  type: CollectionIconType;
  /** text / alpha 的字符；文件类不用 */
  text?: string;
  /** 文件类：attachments.id */
  fileId?: string;
  /** 前景色 */
  fg?: string;
  /** 背景色 */
  bg?: string;
}

export interface Collection {
  id: string;
  name: string;
  kind: CollectionKind;
  parentId: string | null;
  orderKey: string;
  description: string;
  cover?: string | null;
  /** 自定义图标（F-C08）；没设为 null，各处回退到原来的外观 */
  icon: CollectionIcon | null;
  status: 'ongoing' | 'finished' | 'archived';
  rule: SmartRule | null; // 智能集合（F-C04）；普通集合为 null
  isRoot: boolean;
  timeRangeAuto: boolean;
  timeRangeStart?: string | null;
  timeRangeEnd?: string | null;
  deviceId: string;
  rev: number;
  hlc: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 隐私：开启隐私模式后默认隐藏 */
  isPrivate: boolean;
}

export interface Member {
  collectionId: string;
  memberType: 'event' | 'collection';
  memberId: string;
  orderKey: string;
  note: string;
  hlc: string;
  deletedAt: string | null;
}
