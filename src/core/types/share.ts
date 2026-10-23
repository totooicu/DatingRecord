// 事件集 / 人物分享的交换格式。
//
// 和整库备份（LibraryFile）是两回事：
//   · 备份是「我的全部数据」，用来迁移 / 恢复；
//   · 分享是「我的一段故事」，用来发给别人看或让他导进去。
// 所以格式单独定、带 format 标记——导入时能明确报错，而不是把两种文件混着猜。
//
// 分享有两种口径：
//   · scope = 'collection'：一个事件集（含子事件集）以及它真正用到的东西；
//   · scope = 'person'：一个人参与过的全部事件（不带事件集结构，导入时落到指定集合）。
//
// 不管哪种口径，事件涉及的人物一定会被带上——否则导进去的事件就是无主的。
// 人物带多少由 level 决定（见 ShareLevel），这是分享里唯一的「隐私开关」。

import type { Attachment, ChatMessage, Collection, DREvent, Member, Person } from '.';

/**
 * 分享程度：从最完整到最隐蔽是一条单向递减的阶梯，custom 是「自己挑」。
 *
 * - full      原样：人物资料整份带走（属性、备注、头像、标签、别名）
 * - noPrivate 去私：隐私事件整条剔除；隐私人物降为化名、只留名字
 * - namesOnly 只名：人物只保留姓名，属性 / 备注 / 头像 / 标签全不带
 * - alias     化名：姓名换成代号（阿青、阿岚…），同一份分享里映射固定
 * - custom    自选：只名 + 用户勾选的那几个属性
 */
export type ShareLevel = 'full' | 'noPrivate' | 'namesOnly' | 'alias' | 'custom';

export const SHARE_LEVELS: { key: ShareLevel; title: string; desc: string }[] = [
  { key: 'full', title: '原样', desc: '人物资料整份带走：属性、备注、头像、标签、别名' },
  { key: 'noPrivate', title: '去私', desc: '标记为隐私的事件不带走；隐私人物只留化名' },
  { key: 'namesOnly', title: '只名', desc: '人物只留姓名，属性与备注一概不带' },
  { key: 'alias', title: '化名', desc: '姓名换成代号，用来分享连名字都不想露的记录' },
  { key: 'custom', title: '自选', desc: '只留姓名，再加你勾选的那几个属性' },
];

export interface ShareFile {
  /** 格式标记：和 .drp.json 区分 */
  format: 'dr-share';
  /** v1 = 没有等级概念（等价于 full）；v2 起带 scope / level */
  version: 1 | 2;
  /** 分享的是事件集还是人物；v1 文件没有这个字段，按 collection 处理 */
  scope?: 'collection' | 'person';
  /** 分享程度；v1 文件没有这个字段，按 full 处理 */
  level?: ShareLevel;
  /** 自选等级下带走的属性 key（其余等级为空数组） */
  attrKeys?: string[];
  /** 人物分享时的来源人名，导入时用来拼默认事件集名 */
  sourceName?: string;
  exportedAt: string;
  app: string;
  /** 被分享的那个集合的 id（collections[0] 未必是它，按 id 找）；人物分享为空串 */
  rootId: string;
  collections: Collection[];
  /** 只含上述集合的成员关系；人物分享为空 */
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
