// 顶部四格步骤条 + 关窗前的确认弹窗。

import { draftsEnabled } from '../../../core/drafts';
import { Modal } from '../../common';
import { STEPS } from './model';

export function StepBar({ step }: { step: number }) {
  return (
    <div className="share-steps" aria-label="分享步骤">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const cls =
          n === step ? 'share-step share-step-on' : n < step ? 'share-step share-step-done' : 'share-step';
        return (
          <span key={label} className={cls}>
            <em>{n}</em>
            {label}
          </span>
        );
      })}
    </div>
  );
}

/** 有选择时关窗要问一句：这些选择没写进库，关了就得重选 */
export function ConfirmCloseModal({
  onKeep,
  onDiscard,
}: {
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <Modal
      title="取消这次分享？"
      onClose={onKeep}
      footer={
        <>
          <button className="btn" onClick={onKeep}>
            继续编辑
          </button>
          <button className="btn btn-danger" onClick={onDiscard}>
            放弃并关闭
          </button>
        </>
      }
    >
      <p>取消后这次的选择会丢掉：事件集、挑掉的事件、多选的人物、分享程度都要重新选一遍。</p>
      <p className="muted small">
        {draftsEnabled()
          ? '只有刷新、切走或误关页面时才会自动留底；点「放弃并关闭」会把草稿一起删掉。'
          : '「设置 → 功能体验 → 未完成的记录」可以打开草稿保护，误关页面时自动留底。'}
      </p>
    </Modal>
  );
}
