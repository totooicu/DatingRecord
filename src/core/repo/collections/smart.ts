// 智能集合（F-C04）：规则求值。
//
// 核心决定：成员不落库。collection_members 里一条都不写，读取时把 rule
// 翻译成 listEvents 的过滤器现算——新事件满足条件自动进集合，事件被删
// 自动消失，永远不会出现「手动集合里躺着已删除事件」这种腐坏。

import type { DREvent } from '../../types';
import type { SmartRule } from '../../types';
import { listEvents, type EventFilter } from '../events';
import type { Collection } from '../../types';

export function emptyRule(): SmartRule {
  return {};
}

export function isSmart(c: Pick<Collection, 'kind'>): boolean {
  return c.kind === 'smart';
}

/** 空规则 = 未设任何条件（等于全库）。新建智能集合时用它触发规则编辑弹窗 */
export function isEmptyRule(rule: SmartRule | null | undefined): boolean {
  const r = rule ?? {};
  return !r.keyword?.trim() && !r.tag?.trim() && !r.kind && !r.personId && !r.minRating && !r.withinDays;
}

/** 规则 → listEvents 入参。空规则 = 全库（智能集合不设条件就没意义，UI 会拦） */
export function ruleToFilter(rule: SmartRule | null | undefined): EventFilter {
  const r = rule ?? {};
  return {
    keyword: r.keyword?.trim() || undefined,
    tag: r.tag?.trim() || undefined,
    kind: r.kind || undefined,
    personId: r.personId || undefined,
    minRating: r.minRating ? Number(r.minRating) : undefined,
    fromTs: r.withinDays ? Date.now() - Number(r.withinDays) * 86400000 : undefined,
  };
}

/** 动态求值：当前满足规则的事件（倒序，同时间线） */
export function listSmartEvents(c: Collection): DREvent[] {
  if (!isSmart(c)) return [];
  return listEvents(ruleToFilter(c.rule as SmartRule | null));
}

export function smartEventCount(c: Collection): number {
  return listSmartEvents(c).length;
}

/** 人话版规则摘要，给树提示和详情页用 */
export function describeRule(rule: SmartRule | null | undefined, nameOf?: (id: string) => string): string {
  const r = rule ?? {};
  const parts: string[] = [];
  if (r.keyword?.trim()) parts.push(`含「${r.keyword.trim()}」`);
  if (r.tag?.trim()) parts.push(`标签 #${r.tag.trim()}`);
  if (r.kind) parts.push(`类型 ${r.kind}`);
  if (r.personId) parts.push(`人物「${nameOf ? nameOf(r.personId) : r.personId}」`);
  if (r.minRating) parts.push(`评分 ≥ ${r.minRating}`);
  if (r.withinDays) parts.push(`最近 ${r.withinDays} 天`);
  return parts.length ? parts.join(' · ') : '全部事件（未设条件）';
}
