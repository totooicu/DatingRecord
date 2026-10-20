// 领域类型定义（对应架构文档 §3/§4/§5）

export type AttributeType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'money'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'enumMulti'
  | 'boolean'
  | 'rating'
  | 'tag'
  | 'phone'
  | 'email'
  | 'url'
  | 'social'
  | 'address'
  | 'geo'
  | 'color'
  | 'media'
  | 'relation'
  | 'json'
  | 'computed';

export const ATTRIBUTE_TYPES: { value: AttributeType; label: string }[] = [
  { value: 'text', label: '单行文本' },
  { value: 'longtext', label: '多行文本' },
  { value: 'number', label: '数字（可带单位）' },
  { value: 'money', label: '金额' },
  { value: 'date', label: '日期' },
  { value: 'datetime', label: '日期时间' },
  { value: 'enum', label: '单选枚举' },
  { value: 'enumMulti', label: '多选枚举' },
  { value: 'boolean', label: '是/否' },
  { value: 'rating', label: '评分' },
  { value: 'tag', label: '标签（自由）' },
  { value: 'phone', label: '电话' },
  { value: 'email', label: '邮箱' },
  { value: 'url', label: '链接' },
  { value: 'social', label: '社交账号' },
  { value: 'address', label: '地址' },
  { value: 'geo', label: '坐标' },
  { value: 'color', label: '颜色' },
  { value: 'media', label: '图片/附件' },
  { value: 'relation', label: '关联人物' },
  { value: 'json', label: '结构化数据（兜底）' },
];

/** 属性定义：决定类型、校验、显示。key 不可改，type 不可改，删除=归档 */
export interface AttributeDef {
  key: string;
  label: string;
  type: AttributeType;
  group: string;
  options?: string[];
  unit?: string;
  max?: number; // rating 上限
  required?: boolean;
  sensitive?: boolean;
  timeVarying?: boolean;
  archived: boolean;
  orderKey: string;
  hlc: string;
}

/** 属性值：只存值，类型由 def 决定；额外元信息保证脱离字典也能解析 */
export interface AttributeValue {
  v: unknown;
  unit?: string;
  precision?: string;
  note?: string;
  updatedAt?: string; // hlc
}

export interface AttrHistoryEntry {
  id: string;
  personId: string;
  key: string;
  valueJson: string;
  changedAt: string;
  byEventId?: string | null;
  reason?: string;
}

export interface Person {
  id: string;
  displayName: string;
  aliases: string[];
  kind: 'person' | 'group';
  status: 'active' | 'archived';
  avatar?: string | null;
  tags: string[];
  attrs: Record<string, AttributeValue>;
  notes: string;
  deviceId: string;
  rev: number;
  hlc: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ParticipantRole = 'primary' | 'companion' | 'thirdParty' | 'self';

export interface Participant {
  personId: string;
  role: ParticipantRole;
  note?: string;
  perPerson?: Record<string, unknown>;
}

export interface EventMetrics {
  rating?: number;
  cost?: number;
  currency?: string;
  mood?: string;
  intimacyDelta?: number;
}

export interface Place {
  name?: string;
  address?: string;
  geo?: { lat: number; lng: number } | null;
}

export interface RelatedEvent {
  type: 'followedBy' | 'causedBy' | 'sameDay';
  targetId: string;
}

export interface DREvent {
  id: string;
  title: string;
  kind: string;
  time: import('./time').TimeSpec;
  startTs: number | null;
  endTs: number | null;
  place: Place;
  participants: Participant[];
  content: string;
  media: string[];
  tags: string[];
  metrics: EventMetrics;
  relatedEvents: RelatedEvent[];
  primaryCollectionId: string | null;
  deviceId: string;
  rev: number;
  hlc: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

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

export interface Attachment {
  id: string;
  sha256: string;
  mime: string;
  name: string;
  data: string; // base64 dataURL（网页版内嵌存储）
  size: number;
  takenAt?: string | null;
  createdAt: string;
}

export interface OplogEntry {
  seq: number;
  hlc: string;
  deviceId: string;
  entity: string;
  entityId: string;
  op: 'insert' | 'update' | 'delete';
  payload: string | null;
  createdAt: string;
}

/** 导入导出的交换格式 */
export interface LibraryFile {
  schemaVersion: number;
  meta: {
    id: string;
    name: string;
    exportedAt: string;
    app: string;
    deviceId: string;
  };
  attributeDefs: AttributeDef[];
  persons: Person[];
  attrHistory: AttrHistoryEntry[];
  events: DREvent[];
  collections: Collection[];
  members: Member[];
  attachments?: Attachment[];
}

export const SCHEMA_VERSION = 1;
