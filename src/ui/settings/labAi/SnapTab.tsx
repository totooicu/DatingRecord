// 成果 tab：AI / CLI 每次动手前自动留的整库快照，点开能看具体建了谁、删了谁。

import type { Paged } from '../../common/usePaged';
import type { SnapDiffItem, SnapMeta } from '../../../core/snapshots';
import { fmtSnapTime } from '../../../core/snapshots';
import { Paginator } from '../../common/Paginator';
import { Empty } from '../../common';
import { SnapNameChips } from './SnapChips';
import { snapTitle } from './model';

export function SnapTab({
  snaps,
  paged,
  onOpen,
  onOpenRecord,
  onApply,
  onDiscard,
  onAccept,
  onRollback,
}: {
  snaps: SnapMeta[];
  paged: Paged<SnapMeta>;
  onOpen: (s: SnapMeta) => void;
  onOpenRecord: (snapId: string, item: SnapDiffItem) => void;
  onApply: (id: string) => void;
  onDiscard: (id: string) => void;
  onAccept: (id: string) => void;
  onRollback: (id: string) => void;
}) {
  return (
    <div className="aichat-snaps">
      <div className="aichat-subhead">
        <span className="muted small">
          AI / CLI 动手前会自动记录：做了什么、做成了什么都在这里，点开能看具体结果。
        </span>
      </div>
      {snaps.length === 0 ? (
        <Empty compact text="还没有成果。" />
      ) : (
        <ul className="aichat-snap-list">
          {paged.pageItems.map((s) => (
            <li key={s.id}>
              {/* 卡片只给「标题 + 时间」。具体改了谁、加了谁、删了谁，
                  点开详情里按 新增 / 修改 / 删除 分组看——列表上再堆净变化数字和
                  对象 chip，既占地方又和详情重复，用户扫一眼也分不清哪个是哪个。 */}
              <div className="aichat-snap-block">
                <button
                  type="button"
                  className="aichat-snap-main"
                  onClick={() => onOpen(s)}
                  title="查看这份成果的具体操作"
                >
                  <span className="aichat-snap-title">{snapTitle(s)}</span>
                  <span className="aichat-snap-sub">
                    {s.review === 'pending' && (
                      <span className="aichat-snap-status aichat-snap-status-pending">待执行</span>
                    )}
                    {s.review === 'applied' && (
                      <span className="aichat-snap-status aichat-snap-status-done">已执行</span>
                    )}
                    <span className="aichat-snap-time">{fmtSnapTime(s.createdAt)}</span>
                  </span>
                </button>
                <SnapNameChips snap={s} onPick={(item) => onOpenRecord(s.id, item)} />
              </div>
              <span className="aichat-snap-ops">
                {s.review === 'pending' ? (
                  <>
                    <button className="aichat-linkbtn aichat-linkbtn-go" onClick={() => onApply(s.id)}>
                      执行
                    </button>
                    <button className="aichat-linkbtn aichat-linkbtn-dim" onClick={() => onDiscard(s.id)}>
                      放弃
                    </button>
                  </>
                ) : (
                  <>
                    <button className="aichat-linkbtn" onClick={() => onAccept(s.id)}>
                      接受
                    </button>
                    <button className="aichat-linkbtn aichat-linkbtn-danger" onClick={() => onRollback(s.id)}>
                      放弃改动
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Paginator paged={paged} />
    </div>
  );
}
