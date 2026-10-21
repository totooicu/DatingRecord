// 事件集与成员

export type CollectionKind = 'root' | 'timeline' | 'arc' | 'topic' | 'project';

export interface Collection {
  id: string;
  name: string;
  kind: CollectionKind;
  parentId: string | null;
  orderKey: string;
  description: string;
  cover?: string | null;
  status: 'ongoing' | 'finished' | 'archived';
  rule: unknown | null; // 智能集合（v1.5）
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
