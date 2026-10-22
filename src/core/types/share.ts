// 事件集分享的交换格式。
//
// 和整库备份（LibraryFile）是两回事：
//   · 备份是「我的全部数据」，用来迁移 / 恢复；
//   · 分享是「我的一段故事」，用来发给别人看或让他导进去。
// 所以格式单独定、带 format 标记——导入时能明确报错，而不是把两种文件混着猜。
//
// 只装得下一个事件集（含子事件集）以及它真正用到的东西：
// 事件、事件里出现的人物、聊天消息、正文引用到的附件。库里其余内容一概不带走。

import type { Attachment, ChatMessage, Collection, DREvent, Member, Person } from '.';

export interface ShareFile {
  /** 格式标记：和 .drp.json 区分 */
  format: 'dr-share';
  version: 1;
  exportedAt: string;
  app: string;
  /** 被分享的那个集合的 id（collections[0] 未必是它，按 id 找） */
  rootId: string;
  collections: Collection[];
  /** 只含上述集合的成员关系 */
  members: Member[];
  events: DREvent[];
  /** 只含上述事件 / 聊天消息里出现的人物 */
  persons: Person[];
  messages: ChatMessage[];
  /** 正文引用到的附件（含二进制） */
  attachments: Attachment[];
  /** 引用了但没带走的附件数：预览时用来提示「会有几处图片显示不出来」 */
  missingAttachments: number;
}
