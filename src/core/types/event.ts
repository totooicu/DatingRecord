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
  deviceId: string;
  rev: number;
  hlc: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
