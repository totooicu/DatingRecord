// 事件集分享的交换格式。
//
// 和整库备份（LibraryFile）是两回事：
//   · 备份是「我的全部数据」，用来迁移 / 恢复；
//   · 分享是「我的一段故事」，用来发给别人看或让他导进去。
// 所以格式单独定、带 format 标记——导入时能明确报错，而不是把两种文件混着猜。
//
// 口径演变：
//   · v1/v2：一个事件集，或一个人参与过的全部事件；
//   · v3 起：可以多选事件集（含各自子集，取并集）。人物只决定「谁的资料被带走」——
//     事件里出现的其他人照样会带上，但只留姓名，避免事件指向一个不存在的人。
//
// 对外只产出 .drshare.zip（share.json + 附件原文件）；旧的 .drshare.json 仍可导入。

import type { Attachment, ChatMessage, Collection, DREvent, Member, Person } from '.';

/**
 * 分享程度：从最完整到最隐蔽是一条单向递减的阶梯，custom 是「自己挑」。
 *
 * - full      原样：选中的人物资料整份带走（属性、备注、头像、标签、别名）
 * - noPrivate 去私：隐私事件整条剔除；隐私人物降为化名、只留名字
 * - namesOnly 只名：人物只保留姓名，属性 / 备注 / 头像 / 标签全不带
 * - alias     化名：姓名换成代号（阿青、阿岚…），同一份分享里映射固定
 * - custom    自选：只名 + 用户勾选的那几个属性
 */
export type ShareLevel = 'full' | 'noPrivate' | 'namesOnly' | 'alias' | 'custom';

export const SHARE_LEVELS: { key: ShareLevel; title: string; desc: string }[] = [
  { key: 'full', title: '原样', desc: '选中的人物资料整份带走：属性、备注、头像、标签、别名' },
  { key: 'noPrivate', title: '去私', desc: '标记为隐私的事件不带走；隐私人物只留化名' },
  { key: 'namesOnly', title: '只名', desc: '人物只留姓名，属性与备注一概不带' },
  { key: 'alias', title: '化名', desc: '姓名换成代号，用来分享连名字都不想露的记录' },
  { key: 'custom', title: '自选', desc: '只留姓名，再加你勾选的那几个属性' },
];

export interface ShareFile {
  /** 格式标记：和整库备份区分 */
  format: 'dr-share';
  /** v1 = 没有等级概念（等价于 full）；v2 起带 scope / level；v3 起支持多选事件集 */
  version: 1 | 2 | 3;
  /** 分享口径；v3 界面只产出 collection */
  scope?: 'collection' | 'person';
  /** 分享程度；v1 文件没有这个字段，按 full 处理 */
  level?: ShareLevel;
  /** 自选等级下带走的属性 key（其余等级为空数组） */
  attrKeys?: string[];
  /** 文件名用的来源说明：单个事件集名，或「N 个事件集」 */
  sourceName?: string;
  /** v3：选中的事件集 id（各自含子集），顺序即用户勾选顺序 */
  collectionIds?: string[];
  /** v3：点名带走资料的人物 id；其余出现的人物只留姓名 */
  pickedPersonIds?: string[];
  exportedAt: string;
  app: string;
  /** 被分享的那个集合的 id（v1/v2）；v3 等于 collectionIds[0]；人物分享为空串 */
  rootId: string;
  collections: Collection[];
  /** 只含上述集合的成员关系；人物分享为空 */
  members: Member[];
  events: DREvent[];
  /** 只含上述事件 / 聊天消息里出现的人物 */
  persons: Person[];
  messages: ChatMessage[];
  /** 正文引用到的附件（含二进制数据，打 zip 时抽成原文件） */
  attachments: Attachment[];
  /** 引用了但没带走的附件数：预览时用来提示「会有几处图片显示不出来」 */
  missingAttachments: number;
}
