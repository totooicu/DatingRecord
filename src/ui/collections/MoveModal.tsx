// 「移动到…」弹窗：把当前事件集挂到另一个事件集下
import { useMemo } from 'react';
import { getTree, moveCollection, flattenTree } from '../../core/repo/collections';
import { Modal } from '../common';
import { usePaged } from '../common/usePaged';
import { Paginator } from '../common/Paginator';
import { usePageSize } from '../prefs';
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
  // 候选先筛掉「自己」再分页：不然当前这一页可能白白被排除掉的那条占一个位置
  const flat = useMemo(() => flattenTree(getTree()).filter((f) => f.id !== collectionId), [v, collectionId]);
  const paged = usePaged(flat, usePageSize());

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
        {paged.pageItems.map((f) => (
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
      <Paginator paged={paged} />
    </Modal>
  );
}
