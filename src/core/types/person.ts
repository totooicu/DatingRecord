// 人物与事件参与者

import type { AttributeValue } from './attribute';
import type { CollectionIcon } from './collection';

export interface Person {
  id: string;
  displayName: string;
  aliases: string[];
  kind: 'person' | 'group';
  status: 'active' | 'archived';
  /** 老头像（`file:<attachments.id>`）；没有自定义 icon 时回退显示 */
  avatar?: string | null;
  /** 自定义图标，与事件集图标同一套（F-C08）；null/undefined = 回退头像或姓名首字 */
  icon?: CollectionIcon | null;
  tags: string[];
  attrs: Record<string, AttributeValue>;
  notes: string;
  deviceId: string;
  rev: number;
  hlc: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 隐私：开启隐私模式后默认隐藏，不出现在任何列表/详情里 */
  isPrivate: boolean;
}

export type ParticipantRole = 'primary' | 'companion' | 'thirdParty' | 'self';

export interface Participant {
  personId: string;
  role: ParticipantRole;
  note?: string;
  perPerson?: Record<string, unknown>;
}
