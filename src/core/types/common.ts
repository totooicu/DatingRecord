// 附件、操作日志、库交换格式

import type { AttributeDef, AttrHistoryEntry, AttrTemplate } from './attribute';
import type { AiModel } from '../ai/types';
import type { Person } from './person';
import type { DREvent, ChatMessage } from './event';
import type { Collection, Member } from './collection';
import type { Memoir } from './memoir';

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
  /** 隐私：开启隐私模式后默认隐藏 */
  isPrivate?: boolean;
  /** 映射文件：非空表示库里只存链接，二进制不落 IndexedDB */
  sourceUrl?: string | null;
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
  /** 属性模板（v3 新增）；老备份没有这个字段，导入时按空处理 */
  templates?: AttrTemplate[];
  /** AI 模型配置（v6 新增）；不含密钥，密钥永远只在本机 meta */
  aiModels?: AiModel[];
  /** 聊天消息（v9 新增）；老备份没有这个字段，导入时按空处理 */
  messages?: ChatMessage[];
  /** 回忆录（v12 新增）；老备份没有这个字段，导入时按空处理 */
  memoirs?: Memoir[];
}

export const SCHEMA_VERSION = 12;
