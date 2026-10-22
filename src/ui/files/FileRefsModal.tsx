// 文件引用详情：列出所有用到它的地方（事件正文 + 人物头像 + 事件集图标）。
//
// 三个要求：
//   1. 数字必须与文件行上显示的一致 —— 两边都走同一个查询入口
//   2. 点一条要能真的跳过去 —— 事件走 openEvent，人物走 openPerson，
//      由全局回调交给 App（设置页在弹窗里，没有自己的路由栈）
//   3. 图标那栏要写出「被「初恋」用作图标」，用户才能确认上传的图没白传
import { useMemo } from 'react';
import { collectionsUsingFile, eventsReferencingFile, personsUsingFile, type StoredFile } from '../../core/repo/files';
import { useVersion } from '../../store';
import { Modal } from '../common';
import { fmtDate } from './fileFormat';
import { openEvent } from '../openEvent';
import { openPerson } from '../openPerson';

export function FileRefsModal({ file, onClose }: { file: StoredFile; onClose: () => void }) {
  const v = useVersion();
  const items = useMemo(() => eventsReferencingFile(file), [v, file]);
  const avatars = useMemo(() => personsUsingFile(file), [v, file]);
  const icons = useMemo(() => collectionsUsingFile(file), [v, file]);

  return (
    <Modal title={`谁在用「${file.name}」`} onClose={onClose} wide>
      <p className="muted small">
        被 {items.length} 个事件、{avatars.length} 个人物头像、{icons.length} 个事件集图标引用，点一条可以直接跳过去。
      </p>

      {icons.length > 0 && (
        <>
          <h4 className="ref-group-title">事件集图标</h4>
          <ul className="ref-ev-list">
            {icons.map((c) => (
              <li key={`c-${c.id}`}>
                <span className="ref-ev-item ref-ev-item-static">
                  <span className="ref-ev-title">被「{c.name}」用作图标</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {avatars.length > 0 && (
        <>
          <h4 className="ref-group-title">人物头像</h4>
          <ul className="ref-ev-list">
            {avatars.map((p) => (
              <li key={`p-${p.id}`}>
                <button
                  type="button"
                  className="ref-ev-item"
                  onClick={() => {
                    onClose();
                    openPerson(p.id);
                  }}
                >
                  <span className="ref-ev-title">{p.displayName}</span>
                  <span className="ref-ev-go" aria-hidden>
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h4 className="ref-group-title">事件正文</h4>
      {items.length === 0 ? (
        <p className="muted">没有事件在正文里引用它。</p>
      ) : (
        <ul className="ref-ev-list">
          {items.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="ref-ev-item"
                onClick={() => {
                  onClose();
                  openEvent(e.id);
                }}
              >
                <span className="ref-ev-title">{e.title}</span>
                <span className="muted small">
                  {e.startTs !== null ? fmtDate(new Date(e.startTs).toISOString()) : fmtDate(e.createdAt)}
                </span>
                <span className="ref-ev-go" aria-hidden>
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 && avatars.length === 0 && icons.length === 0 && (
        <p className="muted">目前没有任何地方引用这个文件。</p>
      )}
    </Modal>
  );
}
