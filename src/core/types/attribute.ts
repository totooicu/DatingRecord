// 属性系统类型：动态字段的定义、取值与变更历史

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
