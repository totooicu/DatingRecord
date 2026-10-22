// 人物与事件参与者

import type { AttributeValue } from './attribute';

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
