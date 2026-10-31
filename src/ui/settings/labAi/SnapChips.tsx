// 成果里的两颗 chip：详情弹窗里可勾选的 DiffChip、列表卡片上直接露名字的 SnapNameChips。

import type { SnapDiffItem, SnapMeta, SnapTarget } from '../../../core/snapshots';
import { openPerson } from '../../openPerson';
import { openEvent } from '../../openEvent';
import { openCollection } from '../../openCollection';
import { setSnapReturn } from '../../snapReturn';

/** 成果卡 / 详情里的「具体结果」：人名 + 头像、事件集图标、事件名 */
export function DiffChip({
  item,
  onPreview,
  checked,
  onToggle,
  snapId,
  selectable = true,
  onOpenItem,
}: {
  item: SnapDiffItem;
  onPreview?: (t: SnapTarget) => void;
  checked: boolean;
  onToggle: () => void;
  /** 这份成果的 id：点开对象详情前记住它，回来能原样回到这份成果 */
  snapId?: string;
  /** 待执行的成果里对象还没进库，不能接受 / 拒绝勾选，也不该跳去详情页 */
  selectable?: boolean;
  /** 不跳页，改成弹本页的记录详情 */
  onOpenItem?: (item: SnapDiffItem) => void;
}) {
  const open = () => {
    if (onOpenItem) {
      onOpenItem(item);
      return;
    }
    // 删除类只弹「删前内容」的小窗，不离开本页，不需要记来路
    if (item.before && onPreview) {
      onPreview({
        kind: item.kind,
        id: item.id,
        name: item.name,
        snapshot: item.before,
      });
      return;
    }
    // 跳到真实详情页前记一下来路：否则看完就回不到这份成果了
    if (snapId) setSnapReturn(snapId);
    if (item.kind === 'person') openPerson(item.id);
    else if (item.kind === 'event') openEvent(item.id);
    else openCollection(item.id);
  };
  return (
    <label className={`aichat-diff-chip ${selectable && !checked ? 'aichat-diff-chip-reject' : ''}`}>
      {selectable && <input type="checkbox" checked={checked} onChange={onToggle} />}
      <button
        type="button"
        className="aichat-target"
        onClick={open}
        title={item.before ? `查看「${item.name}」删除前内容` : `打开「${item.name}」`}
      >
        <span className="aichat-target-mark" aria-hidden>
          {item.kind === 'person' ? '人' : item.kind === 'event' ? '事' : '集'}
        </span>
        <span className="aichat-target-name">{item.name}</span>
      </button>
    </label>
  );
}

/** 成果卡上直接露名字：新增（+）、删除（−），点一下看详情 */
export function SnapNameChips({ snap, onPick }: { snap: SnapMeta; onPick: (item: SnapDiffItem) => void }) {
  const created = snap.diff?.created ?? [];
  const deleted = snap.diff?.deleted ?? [];
  if (!created.length && !deleted.length) return null;
  return (
    <div className="aichat-targets aichat-review-chips">
      {created.map((item) => (
        <button
          key={`add:${item.kind}:${item.id}`}
          type="button"
          className="aichat-target aichat-review-chip aichat-review-add"
          onClick={() => onPick(item)}
          title={`新增：${item.name}（点开看详情）`}
        >
          <span className="aichat-review-sign" aria-hidden>+</span>
          <span className="aichat-target-name">{item.name}</span>
        </button>
      ))}
      {deleted.map((item) => (
        <button
          key={`del:${item.kind}:${item.id}`}
          type="button"
          className="aichat-target aichat-review-chip aichat-review-del"
          onClick={() => onPick(item)}
          title={`删除：${item.name}（点开看详情）`}
        >
          <span className="aichat-review-sign" aria-hidden>−</span>
          <span className="aichat-target-name">{item.name}</span>
        </button>
      ))}
    </div>
  );
}
