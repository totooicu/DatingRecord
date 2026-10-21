// 附件、操作日志、库交换格式

import type { AttributeDef, AttrHistoryEntry } from './attribute';
import type { Person } from './person';
import type { DREvent } from './event';
import type { Collection, Member } from './collection';

export interface Attachment {
  id: string;
  /** 引用名（hash 名）。老备份里没有这个字段，导入时回退成 id */
  storedId?: string;
  sha256: string;
  mime: string;
  name: string;
  data: string; // base64 dataURL（网页版内嵌存储）
  size: number;
  takenAt?: string | null;
  createdAt: string;
  /** 1 = 与别的文件同 hash 但内容不同（用户确认过碰撞） */
  hashShared?: boolean;
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

export const SCHEMA_VERSION = 2;
