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
  /**
   * QQ 那种分组：一个人只挂一个组（同学 / 家人 / 同事…），组名自己填、填过的从库里复用。
   * 空串 = 未分组。与 `kind === 'group'`（这条人物记录本身是个组织）无关，别看混。
   */
  groupName: string;
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
