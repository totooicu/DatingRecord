// 事件及其子结构

import type { TimeSpec } from '../time';
import type { Participant } from './person';

export interface EventMetrics {
  rating?: number;
  cost?: number;
  currency?: string;
  mood?: string;
  intimacyDelta?: number;
}

export interface Place {
  name?: string;
  address?: string;
  geo?: { lat: number; lng: number } | null;
}

export interface RelatedEvent {
  type: 'followedBy' | 'causedBy' | 'sameDay';
  targetId: string;
}

export interface DREvent {
  id: string;
  title: string;
  kind: string;
  time: TimeSpec;
  startTs: number | null;
  endTs: number | null;
  place: Place;
  participants: Participant[];
  content: string;
  media: string[];
  tags: string[];
  metrics: EventMetrics;
  relatedEvents: RelatedEvent[];
  primaryCollectionId: string | null;
  /** 呈现形态：doc = 普通正文，chat = 聊天形式。与 kind（语义类型）互不干扰 */
  viewMode: 'doc' | 'chat';
  deviceId: string;
  rev: number;
  hlc: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 隐私：开启隐私模式后默认隐藏 */
  isPrivate: boolean;
}

/**
 * 聊天形式里的一条：消息气泡或旁白。
 *
 * type='msg'    —— 头像 + 用户名 + 正文，头像在左或右
 * type='divider'—— 旁白：占一行、无头像，可写时间也可随意写别的
 *
 * ts 可空是刻意的：这是事后补记工具，不是 IM。默认只关心顺序，
 * 需要时才用旁白把时间显式插进来，绝不逼用户为每句话编一个精确时间。
 *
 * replyToId 可空：回复另一条消息。刻意不做线程聚合——事后补记要读起来像流水，
 * 一聚合就成了论坛。引用只在气泡里显示一层，不递归展开。
 */
export interface ChatMessage {
  id: string;
  eventId: string;
  /** 分数排序键，见 core/order.ts */
  orderKey: string;
  type: 'msg' | 'divider';
  personId: string | null;
  side: 'left' | 'right';
  body: string;
  ts: number | null;
  /** 回复（引用）的另一条消息的 id；不是回复则为 null。旁白恒为 null */
  replyToId: string | null;
  deviceId: string;
  rev: number;
  hlc: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
