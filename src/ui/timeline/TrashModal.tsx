// 回收站：软删除的事件可以在此恢复或彻底清除
import { listDeletedEvents, purgeEvent, restoreEvent } from '../../core/repo/events';
import { ConfirmButton, Modal } from '../common';
import { bump } from '../../store';

export function TrashModal({ onClose }: { onClose: () => void }) {
  const items = listDeletedEvents();
  return (
    <Modal title="回收站（软删除的事件）" onClose={onClose} wide>
      <ul className="member-list">
        {items.map((e) => (
          <li key={e.id}>
            <span className="member-type">已删除</span>
            <span className="member-title">{e.title}</span>
            <span className="member-actions">
              <button
                className="btn btn-sm"
                onClick={() => {
                  restoreEvent(e.id);
                  bump();
                }}
              >
                恢复
              </button>
              <ConfirmButton
                text="彻底删除"
                danger
                confirmText="确认彻底删除？"
                onConfirm={() => {
                  purgeEvent(e.id);
                  bump();
                }}
              />
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="muted">回收站是空的</li>}
      </ul>
    </Modal>
  );
}
