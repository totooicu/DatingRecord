// 参与者显示名：时间线的事件行与人物详情共用同一套打码规则。
//
// 隐私模式下，标了隐私的人物显示成「（隐私）」而不是真名——否则一个公开事件里
// 挂着个隐藏人物，名字照样漏出来。getPerson 不受隐私过滤影响，所以这里能拿到
// 私有人物再就地打码。
import { getPerson } from '../../core/repo/persons';
import { isPrivacyMode } from '../../privacy';

export function personNameOf(id: string): string {
  const p = getPerson(id);
  if (!p) return '?';
  if (isPrivacyMode() && p.isPrivate) return '（隐私）';
  return p.displayName;
}
