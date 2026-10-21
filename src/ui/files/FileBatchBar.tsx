// 批量操作条：全选、合并、批量删除。
//
// 合并只允许「选中 2 个以上」：第一个当目标，其余并进去。
// 顺序按当前排序取，用户看到的第一行就是目标，符合直觉。
import { ConfirmButton } from '../common';

export function FileBatchBar({
  count,
  total,
  allSelected,
  targetName,
  onToggleAll,
  onMerge,
  onDelete,
}: {
  count: number;
  total: number;
  allSelected: boolean;
  /** 选中项里的第一个，作为合并目标 */
  targetName?: string;
  onToggleAll: () => void;
  onMerge: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="file-batch-bar">
      <button className="btn btn-sm" onClick={onToggleAll} disabled={total === 0}>
        {allSelected ? '取消全选' : '全选'}
      </button>
      <span className="muted small">已选 {count} 个</span>

      {count >= 2 && targetName && (
        <button className="btn btn-sm" onClick={onMerge} title="把选中的文件合并成第一个">
          合并到「{targetName}」
        </button>
      )}

      {count > 0 ? (
        <ConfirmButton
          compact
          danger
          className="btn-sm"
          text={`删除选中 (${count})`}
          confirmText={`删除选中的 ${count} 个文件？正文里的引用会显示成「附件已删除」。`}
          onConfirm={onDelete}
        />
      ) : (
        <button className="btn btn-sm" disabled>
          删除选中
        </button>
      )}
    </div>
  );
}
