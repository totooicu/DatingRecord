// 四格概览：直接事件 / 含子集合的事件 / 子事件集 / 总金额
import { descendantEventIds } from '../../core/repo/collections';
import { getEvent } from '../../core/repo/events';
import type { MemberItem } from '../../core/repo/collections';
import type { Collection } from '../../core/types';
import { Card } from '../common/Card';

/** 金额用中文习惯的千分位；整数不带小数点，非整数保留两位 */
function fmtMoney(n: number): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

export function CollectionStats({
  collectionId,
  members,
  children,
  smartCount,
  totalCost,
}: {
  collectionId: string;
  members: MemberItem[];
  children: Collection[];
  /** 智能集合：直接事件数是规则现算出来的，不走成员表 */
  smartCount?: number;
  /** 集合（含子集合）里所有事件的金额合计 */
  totalCost: number;
}) {
  return (
    <div className="stat-row">
      <Card
        variant="stat"
        num={smartCount ?? members.filter((m) => m.memberType === 'event').length}
        label={smartCount !== undefined ? '命中事件' : '直接事件'}
      />
      <Card
        variant="stat"
        num={
          smartCount !== undefined
            ? smartCount
            : descendantEventIds(collectionId).filter((eid) => !!getEvent(eid)).length
        }
        label={smartCount !== undefined ? '实时求值' : '含子集合的事件'}
      />
      <Card variant="stat" num={children.length} label="子事件集" />
      <Card variant="stat" num={`¥${fmtMoney(totalCost)}`} label="总金额" hint="含所有子事件集" />
    </div>
  );
}
