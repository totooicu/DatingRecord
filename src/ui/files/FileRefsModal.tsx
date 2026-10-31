// 文件引用详情：列出所有用到它的地方（事件正文 + 人物头像 + 事件集图标）。
//
// 四个要求：
//   1. 数字必须与文件行上显示的一致 —— 两边都走同一个查询入口
//   2. 点一条要能真的跳过去 —— 事件走 openEvent，人物走 openPerson，
//      由全局回调交给 App（设置页在弹窗里，没有自己的路由栈）
//   3. 图标那栏要写出「被「初恋」用作图标」，用户才能确认上传的图没白传
//   4. 事件正文那栏支持批量转移：勾几个事件，把对 a 的引用换成 b
import { useEffect, useMemo, useState } from 'react';
import {
  collectionsUsingFile,
  eventsReferencingFile,
  listFiles,
  personsUsingFile,
  type StoredFile,
} from '../../core/repo/files';
import { transferRefsInEvents } from '../../core/files';
import { bump, useVersion } from '../../store';
import { Modal } from '../common';
import { usePaged } from '../common/usePaged';
import { Paginator } from '../common/Paginator';
import { usePageSize } from '../prefs';
import { fmtDate, fmtSize } from './fileFormat';
import { openEvent } from '../openEvent';
import { openPerson } from '../openPerson';

type Mode = 'list' | 'select' | 'target' | 'confirm';

export function FileRefsModal({ file, onClose }: { file: StoredFile; onClose: () => void }) {
  const v = useVersion();
  const items = useMemo(() => eventsReferencingFile(file), [v, file]);
  const avatars = useMemo(() => personsUsingFile(file), [v, file]);
  const icons = useMemo(() => collectionsUsingFile(file), [v, file]);

  // 批量转移：勾事件 → 选目标文件 → 确认
  const [mode, setMode] = useState<Mode>('list');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<StoredFile | null>(null);
  const [q, setQ] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const candidates = useMemo(
    () => (mode === 'target' ? listFiles().filter((f) => f.id !== file.id) : []),
    [v, mode, file.id],
  );
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? candidates.filter((f) => f.name.toLowerCase().includes(k)) : candidates;
  }, [candidates, q]);

  // 引用一个文件的事件可能有几百条，可选目标文件更是可能有整库：两处都分页。
  // 「全选 / 已选 x / 总数」按全量算，分页只管这一屏渲染多少行。
  const pagedItems = usePaged(items, usePageSize());
  const pagedTargets = usePaged(filtered, usePageSize());
  useEffect(() => {
    pagedTargets.setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const reset = () => {
    setPicked(new Set());
    setTarget(null);
    setQ('');
    setMode('list');
  };

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allOn = items.length > 0 && items.every((e) => picked.has(e.id));
  const toggleAll = () => {
    setPicked(allOn ? new Set() : new Set(items.map((e) => e.id)));
  };

  const commit = () => {
    if (!target || picked.size === 0) return;
    const n = transferRefsInEvents(
      [...picked],
      [file.storedId, file.id],
      target.storedId,
      target.name,
    );
    bump();
    setNote(
      n > 0
        ? `已把 ${n} 个事件里对「${file.name}」的引用改成「${target.name}」。`
        : '选中的事件里没有可改写的引用。',
    );
    reset();
  };

  return (
    <Modal title={`谁在用「${file.name}」`} onClose={onClose} wide>
      {note && <p className="ref-note">{note}</p>}

      {mode === 'list' && (
        <>
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

          <div className="ref-group-head">
            <h4 className="ref-group-title">事件正文</h4>
            {items.length > 0 && (
              <button type="button" className="btn btn-sm" onClick={() => setMode('select')}>
                批量转移…
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="muted">没有事件在正文里引用它。</p>
          ) : (
            <ul className="ref-ev-list">
              {pagedItems.pageItems.map((e) => (
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
                      {e.startTs !== null
                        ? fmtDate(new Date(e.startTs).toISOString())
                        : fmtDate(e.createdAt)}
                    </span>
                    <span className="ref-ev-go" aria-hidden>
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Paginator paged={pagedItems} />

          {items.length === 0 && avatars.length === 0 && icons.length === 0 && (
            <p className="muted">目前没有任何地方引用这个文件。</p>
          )}
        </>
      )}

      {mode === 'select' && (
        <>
          <p className="muted small">
            勾选需要转移的事件，下一步再选目标文件；这些事件正文里对「{file.name}」的引用会整体换过去。
          </p>
          <div className="ref-pick-bar">
            <button type="button" className="btn btn-sm" onClick={toggleAll}>
              {allOn ? '取消全选' : '全选'}
            </button>
            <span className="muted small">已选 {picked.size} / {items.length}</span>
          </div>
          <ul className="ref-ev-list">
            {pagedItems.pageItems.map((e) => (
              <li key={e.id}>
                <label className="ref-ev-item ref-pick">
                  <input
                    type="checkbox"
                    checked={picked.has(e.id)}
                    onChange={() => toggle(e.id)}
                  />
                  <span className="ref-ev-title">{e.title}</span>
                  <span className="muted small">
                    {e.startTs !== null
                      ? fmtDate(new Date(e.startTs).toISOString())
                      : fmtDate(e.createdAt)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Paginator paged={pagedItems} />
          <div className="ref-actions">
            <button type="button" className="btn" onClick={reset}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={picked.size === 0}
              onClick={() => setMode('target')}
            >
              下一步：选目标文件
            </button>
          </div>
        </>
      )}

      {mode === 'target' && (
        <>
          <p className="muted small">
            把选中的 {picked.size} 个事件里对「{file.name}」的引用换成：
          </p>
          <input
            className="input"
            placeholder="搜文件名"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {filtered.length === 0 ? (
            <p className="muted">没有可选的其它文件。</p>
          ) : (
            <ul className="ref-ev-list">
              {pagedTargets.pageItems.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="ref-ev-item"
                    onClick={() => {
                      setTarget(f);
                      setMode('confirm');
                    }}
                  >
                    <span className="ref-ev-title">{f.name}</span>
                    <span className="muted small">{fmtSize(f.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Paginator paged={pagedTargets} />
          <div className="ref-actions">
            <button type="button" className="btn" onClick={() => setMode('select')}>
              返回
            </button>
          </div>
        </>
      )}

      {mode === 'confirm' && target && (
        <>
          <p>
            将把 <strong>{picked.size}</strong> 个事件正文里的
            「{file.name}」改成「{target.name}」。
          </p>
          <p className="muted small">
            只改事件正文；人物头像、事件集图标这类引用不受影响，需要的话去文件页用「合并」处理。
          </p>
          <div className="ref-actions">
            <button type="button" className="btn" onClick={() => setMode('target')}>
              返回
            </button>
            <button type="button" className="btn btn-primary" onClick={commit}>
              确认转移
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
