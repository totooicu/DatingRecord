// 「移动到…」弹窗：把当前事件集挂到另一个事件集下
import { useMemo } from 'react';
import { getTree, moveCollection, flattenTree } from '../../core/repo/collections';
import { Modal } from '../common';
import { useVersion, bump } from '../../store';

export function MoveModal({
  collectionId,
  onClose,
  onError,
}: {
  collectionId: string;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const v = useVersion();
  const flat = useMemo(() => flattenTree(getTree()), [v]);

  return (
    <Modal
      title="移动到…"
      onClose={onClose}
      footer={
        <button className="btn btn-ghost" onClick={onClose}>
          取消
        </button>
      }
    >
      <ul className="pick-list">
        {flat
          .filter((f) => f.id !== collectionId)
          .map((f) => (
            <li key={f.id}>
              <button
                onClick={() => {
                  const r = moveCollection(collectionId, f.id);
                  if (!r.ok) onError(r.reason ?? '移动失败');
                  bump();
                  onClose();
                }}
              >
                {'　'.repeat(f.depth)}
                {f.name}
              </button>
            </li>
          ))}
      </ul>
    </Modal>
  );
}
