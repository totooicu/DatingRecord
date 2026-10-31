// 删除类记录点开后看「删前长什么样」：对象已经软删了，只能看快照里存下来的那一份。

import type { SnapTarget } from '../../../core/snapshots';
import { Modal } from '../../common';

export function SnapPreviewModal({
  target,
  onClose,
}: {
  target: SnapTarget;
  onClose: () => void;
}) {
  const kindLabel = target.kind === 'event' ? '事件' : target.kind === 'person' ? '人物' : '事件集';
  return (
    <Modal title={`删除前的${kindLabel}`} onClose={onClose}>
      <div className="aichat-snap-preview">
        <p className="aichat-snap-preview-name">{target.name}</p>
        {target.snapshot?.timeLabel && <p className="muted small">时间：{target.snapshot.timeLabel}</p>}
        {target.snapshot?.placeName && <p className="muted small">地点：{target.snapshot.placeName}</p>}
        {target.snapshot?.personNames?.length ? (
          <p className="muted small">参与：{target.snapshot.personNames.join('、')}</p>
        ) : null}
        {target.snapshot?.content ? (
          <div className="aichat-snap-preview-body">{target.snapshot.content}</div>
        ) : (
          <p className="muted small">（这条记录没有存正文内容，可点「放弃改动」回退后查看完整记录）</p>
        )}
      </div>
    </Modal>
  );
}
