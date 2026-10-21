// 文件引用详情：点「被 N 处正文引用」后列出引用它的那些事件。
//
// 只读列表，和文件行的计数共用 eventsReferencingFile 的同一个 LIKE 条件，
// 所以弹窗里的条数永远等于行上显示的数字。
import { useMemo } from 'react';
import { eventsReferencingFile, type StoredFile } from '../../core/repo/files';
import { useVersion } from '../../store';
import { Modal } from '../common';
import { fmtDate } from './fileFormat';

export function FileRefsModal({ file, onClose }: { file: StoredFile; onClose: () => void }) {
  const v = useVersion();
  const items = useMemo(() => eventsReferencingFile(file.id), [v, file.id]);

  return (
    <Modal title={`引用「${file.name}」的事件`} onClose={onClose} wide>
      {items.length === 0 ? (
        <p className="muted">目前没有事件引用这个文件。</p>
      ) : (
        <>
          <p className="muted small">
            共 {items.length} 个事件在正文里引用了它；删改事件正文里的引用后，这里的条数会跟着变。
          </p>
          <ul className="merge-list">
            {items.map((e) => (
              <li key={e.id}>
                <span className="merge-rec">
                  <span className="merge-rec-main">{e.title}</span>
                  <span className="muted small">
                    {e.startTs !== null ? fmtDate(new Date(e.startTs).toISOString()) : fmtDate(e.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
