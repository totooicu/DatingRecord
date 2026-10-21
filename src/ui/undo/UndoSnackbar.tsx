// 撤销提示条：动作发生后飘一条「可撤销」，附 Ctrl+Z / Ctrl+Shift+Z。
//
// 快捷键在输入框里不拦——那儿的 Ctrl+Z 是浏览器自带的文本撤销，抢了会被人骂。
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getUndoState, redo, subscribeUndo, undo } from '../../core/db';
import { bump } from '../../store';

const WRITE_MS = 6000;
const DONE_MS = 2200;

export function UndoSnackbar() {
  const state = useSyncExternalStore(subscribeUndo, getUndoState, getUndoState);
  const [text, setText] = useState('');
  const [shown, setShown] = useState(false);

  // 撤销栈每变化一次就重新计时：连续改字段时提示条会一直挂着，
  // 停手 6 秒后才消失，不会写到一半就没了。
  useEffect(() => {
    if (state.lastOp === null) return;
    setShown(true);
    setText(
      state.lastOp === 'undo' ? '已撤销' : state.lastOp === 'redo' ? '已重做' : (state.top?.label ?? ''),
    );
    const ms = state.lastOp === 'write' ? WRITE_MS : DONE_MS;
    const t = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(t);
  }, [state.seq, state.lastOp, state.top?.label]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      e.preventDefault();
      const did = e.shiftKey ? redo() : undo();
      if (did) bump();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!shown) return null;

  return (
    <div className="undo-bar" role="status">
      <span className="undo-text">{text}</span>
      {state.canUndo && (
        <button
          className="undo-btn"
          onClick={() => {
            if (undo()) bump();
          }}
        >
          撤销
        </button>
      )}
      {state.canRedo && (
        <button
          className="undo-btn undo-btn-2"
          onClick={() => {
            if (redo()) bump();
          }}
        >
          重做
        </button>
      )}
    </div>
  );
}
