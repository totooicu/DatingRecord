// 附件、操作日志、库交换格式

import type { AttributeDef, AttrHistoryEntry } from './attribute';
import type { Person } from './person';
import type { DREvent } from './event';
import type { Collection, Member } from './collection';

export interface Attachment {
  id: string;
  sha256: string;
  mime: string;
  name: string;
  data: string; // base64 dataURL（网页版内嵌存储）
  size: number;
  takenAt?: string | null;
  createdAt: string;
}

export interface OplogEntry {
  seq: number;
  hlc: string;
  deviceId: string;
  entity: string;
  entityId: string;
  op: 'insert' | 'update' | 'delete';
  payload: string | null;
  createdAt: string;
}

/** 导入导出的交换格式 */
export interface LibraryFile {
  schemaVersion: number;
  meta: {
    id: string;
    name: string;
    exportedAt: string;
    app: string;
    deviceId: string;
  };
  attributeDefs: AttributeDef[];
  persons: Person[];
  attrHistory: AttrHistoryEntry[];
  events: DREvent[];
  collections: Collection[];
  members: Member[];
  attachments?: Attachment[];
}

export const SCHEMA_VERSION = 1;
