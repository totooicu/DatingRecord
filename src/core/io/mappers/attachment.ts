// 附件 行 → 对象（反向见 export.ts：二进制要另外读 IndexedDB）

import type { Row } from './types';
import type { Attachment } from '../../types';

export function rowToAttachment(r: Row): Attachment {
  return {
    id: r.id,
    storedId: r.stored_id || r.id,
    sha256: r.sha256 ?? '',
    mime: r.mime ?? '',
    name: r.name ?? '',
    data: r.data ?? '',
    size: r.size ?? 0,
    takenAt: r.taken_at ?? null,
    createdAt: r.created_at ?? '',
    hashShared: Number(r.hash_shared ?? 0) === 1,
    isPrivate: Number(r.is_private ?? 0) === 1,
  };
}
