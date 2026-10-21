// 撤销提示条上的那行字：从刚写入的 oplog 行反推「刚才动了什么」。
//
// 拆出来单独一个文件，是因为它纯粹是「给人看的一句话」——跟快照/栈这些
// 核心机制无关，而 entity → 中文名的映射表会随业务增长（再加「附件」
// 「标签」就得回来改），混在引擎里只会把引擎撑大。

import type { UndoOpRow } from './oplog';

const ENTITY_NAME: Record<string, string> = {
  person: '人物',
  event: '事件',
  collection: '事件集',
  attribute_def: '属性',
  template: '属性模板',
  collection_member: '事件集成员',
  file: '文件',
  setting: '设置',
};

const VERB: Record<string, string> = {
  insert: '新建',
  delete: '删除',
  update: '修改',
};

/** 从 oplog 行取标题；payload 是 JSON，坏了就退回空串，不影响提示 */
function titleOf(row: UndoOpRow): string {
  if (!row.payload) return '';
  try {
    const t = (JSON.parse(row.payload) as { title?: unknown }).title;
    return typeof t === 'string' ? t : '';
  } catch {
    return '';
  }
}

/** 形如：修改人物「林晚」 / 删除事件 / 修改事件集成员 */
export function describeOp(row: UndoOpRow): string {
  const verb = VERB[row.op] ?? '修改';
  const name = ENTITY_NAME[row.entity] ?? row.entity;
  const title = titleOf(row);
  return title ? `${verb}${name}「${title}」` : `${verb}${name}`;
}
