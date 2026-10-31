// 成果详情弹窗：这一轮到底新增 / 修改 / 删除了谁。
//
// 待执行的成果可以逐条勾选「拒绝」，其余保留；已执行的只能整轮回退。
// 打开时会重算一次净变化（见父组件）：快照存的是动手那一刻的结果，
// 之后用户自己又改过数据的话，这里要反映的是当前状态。

import type { SnapDiffItem, SnapMeta, SnapTarget } from '../../../core/snapshots';
import { fmtBytes, fmtSnapTime } from '../../../core/snapshots';
import { Modal } from '../../common';
import { DiffChip } from './SnapChips';
import { SNAP_SRC, snapTitle } from './model';

export function SnapDetailModal({
  snap,
  rejected,
  onToggleReject,
  onRejectPicked,
  onApply,
  onDiscard,
  onOpenRecord,
  onPreview,
  onClose,
}: {
  snap: SnapMeta;
  /** 被用户勾为「拒绝」的条目，key 是 `${action}:${id}` */
  rejected: Set<string>;
  onToggleReject: (key: string) => void;
  onRejectPicked: () => void;
  onApply: (id: string) => void;
  onDiscard: (id: string) => void;
  onOpenRecord: (snapId: string, item: SnapDiffItem) => void;
  onPreview: (t: SnapTarget) => void;
  onClose: () => void;
}) {
  const diff = snap.diff;
  const selectable = snap.review !== 'pending';
  // 待执行的对象还没进库：点名字只能看这份暂存的成果，不能跳去详情页
  const openItem = snap.review === 'pending' ? (it: SnapDiffItem) => onOpenRecord(snap.id, it) : undefined;
  return (
    <Modal title="成果详情" onClose={onClose} wide>
      <div className="aichat-snap-detail">
        <p className="aichat-snap-detail-title">{snapTitle(snap)}</p>
        <p className="muted small">
          {fmtSnapTime(snap.createdAt)} · {SNAP_SRC[snap.source] ?? snap.source} ·{' '}
          {snap.persons} 人 / {snap.events} 事件 / {fmtBytes(snap.bytes)}
        </p>

        {diff ? (
          <div className="aichat-diff">
            {diff.created.length > 0 && (
              <div className="aichat-diff-group aichat-diff-created">
                <div className="aichat-diff-head">新增 {diff.created.length}</div>
                <div className="aichat-diff-items">
                  {diff.created.map((t) => (
                    <DiffChip
                      key={`c:${t.id}`}
                      item={t}
                      snapId={snap.id}
                      selectable={selectable}
                      onOpenItem={openItem}
                      checked={!rejected.has(`created:${t.id}`)}
                      onToggle={() => onToggleReject(`created:${t.id}`)}
                    />
                  ))}
                </div>
              </div>
            )}
            {diff.updated.length > 0 && (
              <div className="aichat-diff-group aichat-diff-updated">
                <div className="aichat-diff-head">修改 {diff.updated.length}</div>
                <div className="aichat-diff-items">
                  {diff.updated.map((t) => (
                    <DiffChip
                      key={`u:${t.id}`}
                      item={t}
                      snapId={snap.id}
                      selectable={selectable}
                      onOpenItem={openItem}
                      checked={!rejected.has(`updated:${t.id}`)}
                      onToggle={() => onToggleReject(`updated:${t.id}`)}
                    />
                  ))}
                </div>
              </div>
            )}
            {diff.deleted.length > 0 && (
              <div className="aichat-diff-group aichat-diff-deleted">
                <div className="aichat-diff-head">删除 {diff.deleted.length}</div>
                <div className="aichat-diff-items">
                  {diff.deleted.map((t) => (
                    <DiffChip
                      key={`d:${t.id}`}
                      item={t}
                      snapId={snap.id}
                      onPreview={onPreview}
                      selectable={selectable}
                      onOpenItem={openItem}
                      checked={!rejected.has(`deleted:${t.id}`)}
                      onToggle={() => onToggleReject(`deleted:${t.id}`)}
                    />
                  ))}
                </div>
              </div>
            )}
            {(diff.reverted?.length ?? 0) > 0 && (
              <p className="muted small aichat-diff-note">
                另有 {diff.reverted.length} 个对象这一轮动过又复原（比如建了又删），
                净变化为零，所以不在上面三组里：
                {diff.reverted.map((t) => t.name).join('、')}
              </p>
            )}
            {snap.review === 'pending' ? (
              <div className="aichat-diff-actions">
                <button
                  className="aichat-chipbtn aichat-chipbtn-primary"
                  onClick={() => onApply(snap.id)}
                >
                  执行这轮改动
                </button>
                <button className="aichat-chipbtn aichat-chipbtn-danger" onClick={() => onDiscard(snap.id)}>
                  放弃
                </button>
                <span className="muted small">执行前库里的数据没有变</span>
              </div>
            ) : rejected.size > 0 ? (
              <div className="aichat-diff-actions">
                <button className="aichat-chipbtn aichat-chipbtn-danger" onClick={onRejectPicked}>
                  拒绝选中的 {rejected.size} 项改动
                </button>
                <span className="muted small">其余保留</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
