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

export interface Collection {
  id: string;
  name: string;
  kind: CollectionKind;
  parentId: string | null;
  orderKey: string;
  description: string;
  cover?: string | null;
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
