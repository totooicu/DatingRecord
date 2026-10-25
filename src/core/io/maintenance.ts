// 库级维护：清空与体积查询

import { transact, run, getDb, noteUndoStep, suspendUndo, resumeUndo } from '../db';
import { clearBlobs } from '../db/blob';
import { seedDefaults } from '../db/seed';

export async function clearAllData(): Promise<void> {
  // 附件二进制在 IndexedDB，不在这些表里，必须单独清
  await clearBlobs();
  noteUndoStep('清空全部数据');
  suspendUndo();
  try {
  transact(() => {
    for (const t of [
      'oplog',
      'collection_members',
      'collection_closure',
      'collections',
      'memoirs',
      'event_participants',
      'events',
      'person_attr_history',
      'persons',
      'attribute_defs',
      'attachments',
    ]) {
      run(`DELETE FROM ${t}`);
    }
  });
  // 清空后要回到「刚装好」的状态：根事件集和默认属性都得补回来。
  // 少了根集合，之后新建的集合 parent_id 为空，树里一个都看不见——
  // 「只有事件、没有事件集」就是这么来的。
  seedDefaults(getDb());
  } finally {
    resumeUndo();
  }
}

export function dbSizeBytes(): number {
  const bytes = getDb().export();
  return bytes.length;
}
