import { useLayoutEffect, useRef, useState } from 'react';
import { fileRefSyntax, type StoredFile } from '../../core/repo/files';
import { uploadFileQuiet } from '../../core/files';
import { getSmallLimit } from '../filePrefs';
import { bump } from '../../store';
import { Modal } from '../common';
import { FilesSection } from '../files';
import { MarkdownView } from './MarkdownView';
import { MarkdownToolbar } from './MarkdownToolbar';
import { caretOf, insertText, type Caret } from './insert';

/**
 * 正文编辑器：工具栏 + textarea + 预览。
 *
 * 手机上工具栏横向滚动，编辑/预览用 tab 切换（同屏放两栏会挤没）。
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder = '记录发生了什么…支持 Markdown，可插图',
  rows = 6,
  autoFocus = false,
  autoGrow = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  /** 高度跟着内容长，不出现内部滚动条（聊天里就地改一句话时很需要） */
  autoGrow?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [libOpen, setLibOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** 变换后立刻同步 DOM 值，避免连续插入时读到未提交的旧文本 */
  const apply = (fn: (c: Caret) => Caret) => {
    const el = ref.current;
    if (!el) return;
    const out = fn(caretOf(el));
    el.value = out.text;
    el.setSelectionRange(out.start, out.end);
    el.focus();
    onChange(out.text);
  };

  // 先归零再按内容撑开，删字时才会跟着缩回去
  useLayoutEffect(() => {
    if (!autoGrow) return;
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, autoGrow]);

  const pick = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      for (const f of Array.from(list)) {
        // 小文件自动判重；大文件撞车时按「都不一样」处理，不让插入动作被打断
        // （真正的裁量入口在设置的文件库里）
        const saved = await uploadFileQuiet(f, getSmallLimit());
        apply((c) => insertText(c, fileRefSyntax(saved)));
      }
      // 让设置页的文件列表同步刷新
      bump();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '文件上传失败');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /** 从文件库挑一个已有文件：插入引用后关掉悬浮窗，回到正文 */
  const pickExisting = (f: StoredFile) => {
    apply((c) => insertText(c, fileRefSyntax(f)));
    setLibOpen(false);
  };

  return (
    <div className="md-editor">
      <div className="md-editor-head">
        <div className="md-tabs">
          <button
            type="button"
            className={mode === 'edit' ? 'md-tab md-tab-on' : 'md-tab'}
            onClick={() => setMode('edit')}
          >
            编辑
          </button>
          <button
            type="button"
            className={mode === 'preview' ? 'md-tab md-tab-on' : 'md-tab'}
            onClick={() => setMode('preview')}
          >
            预览
          </button>
        </div>
        {mode === 'edit' && (
          <MarkdownToolbar
            apply={apply}
            onPickFile={() => fileRef.current?.click()}
            onOpenFiles={() => setLibOpen(true)}
          />
        )}
      </div>

      {mode === 'edit' ? (
        <textarea
          ref={ref}
          rows={rows}
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : value.trim() ? (
        <div className="md-preview">
          <MarkdownView source={value} />
        </div>
      ) : (
        <div className="md-preview muted">还没有内容</div>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        accept="image/*,video/*,audio/*,.pdf,.txt,.md,.json"
        onChange={(e) => void pick(e.target.files)}
      />
      {busy && <p className="muted small">正在上传…</p>}
      {err && <p className="warn-line">{err}</p>}

      {libOpen && (
        <Modal title="文件库 · 插入引用" wide onClose={() => setLibOpen(false)}>
          <FilesSection onPick={pickExisting} />
        </Modal>
      )}
    </div>
  );
}
