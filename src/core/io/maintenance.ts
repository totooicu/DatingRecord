// 库级维护：清空与体积查询

import { transact, run, getDb } from '../db';
import { clearBlobs } from '../db/blob';

export async function clearAllData(): Promise<void> {
  // 附件二进制在 IndexedDB，不在这些表里，必须单独清
  await clearBlobs();
  transact(() => {
    for (const t of [
      'oplog',
      'collection_members',
      'collection_closure',
      'collections',
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
}

export function dbSizeBytes(): number {
  const bytes = getDb().export();
  return bytes.length;
}
