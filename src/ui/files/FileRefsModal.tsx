// 文件引用详情：点「被 N 个事件引用」后列出引用它的那些事件。
//
// 两个要求：
//   1. 条数必须与文件行上显示的数字一致 —— 两边都走 eventsReferencingFile
//   2. 点一条事件要能真的跳过去 —— 这里只把 id 交出去，由 openEvent
//      通过全局回调交给 App（设置页没有自己的路由栈，不能就地开编辑框）
import { useMemo } from 'react';
import { eventsReferencingFile, type StoredFile } from '../../core/repo/files';
import { useVersion } from '../../store';
import { Modal } from '../common';
import { fmtDate } from './fileFormat';

export function FileRefsModal({
  file,
  onClose,
  onOpenEvent,
}: {
  file: StoredFile;
  onClose: () => void;
  /** 跳转到某条事件（父层负责关弹窗并切到时间线） */
  onOpenEvent?: (eventId: string) => void;
}) {
  const v = useVersion();
  const items = useMemo(() => eventsReferencingFile(file), [v, file]);

  return (
    <Modal title={`引用「${file.name}」的事件`} onClose={onClose} wide>
      {items.length === 0 ? (
        <p className="muted">目前没有事件引用这个文件。</p>
      ) : (
        <>
          <p className="muted small">
            共 {items.length} 个事件在正文里引用了它，点一条可以直接打开那条事件。
          </p>
          <ul className="ref-ev-list">
            {items.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="ref-ev-item"
                  onClick={() => {
                    onClose();
                    onOpenEvent?.(e.id);
                  }}
                  disabled={!onOpenEvent}
                  title={onOpenEvent ? '打开这条事件' : undefined}
                >
                  <span className="ref-ev-title">{e.title}</span>
                  <span className="muted small">
                    {e.startTs !== null ? fmtDate(new Date(e.startTs).toISOString()) : fmtDate(e.createdAt)}
                  </span>
                  {onOpenEvent && (
                    <span className="ref-ev-go" aria-hidden>
                      ›
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
