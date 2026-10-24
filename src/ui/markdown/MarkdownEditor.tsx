import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fileRefSyntax, type StoredFile } from '../../core/repo/files';
import { uploadFileQuiet } from '../../core/files';
import { getSmallLimit } from '../filePrefs';
import { bump } from '../../store';
import { FilePickInput, Modal } from '../common';
import { FilesSection } from '../files';
import { MarkdownView } from './MarkdownView';
import { MarkdownToolbar } from './MarkdownToolbar';
import { caretOf, insertText, type Caret } from './insert';
import { highlightMarkdown } from './highlight';

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
  const hlRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [full, setFull] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 高亮层：把同一段文字上色后垫在透明文字的 textarea 背后
  const highlighted = useMemo(() => highlightMarkdown(value), [value]);

  /** 输入框内部滚动时，高亮层跟着滚，否则字会「漂」出编辑框 */
  const syncScroll = () => {
    const el = ref.current;
    const hl = hlRef.current;
    if (!el || !hl) return;
    hl.scrollTop = el.scrollTop;
    hl.scrollLeft = el.scrollLeft;
  };

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

  // 全屏时锁定背景滚动，否则手指划到输入框外面会把后面的弹窗带着滚
  useEffect(() => {
    if (!full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [full]);

  // 先归零再按内容撑开，删字时才会跟着缩回去
  useLayoutEffect(() => {
    if (!autoGrow) return;
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, autoGrow]);

  // 切换全屏、程序化插入文字后，textarea 的滚动位置可能变，高亮层补一次
  useLayoutEffect(syncScroll, [value, full, mode]);

  const pick = async (list: FileList | File[] | null) => {
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
    }
  };

  /** 从文件库挑一个已有文件：插入引用后关掉悬浮窗，回到正文 */
  const pickExisting = (f: StoredFile) => {
    apply((c) => insertText(c, fileRefSyntax(f)));
    setLibOpen(false);
  };

  return (
    <div className={full ? 'md-editor md-editor-full' : 'md-editor'}>
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
          <button
            type="button"
            className="md-tab md-full-btn"
            onClick={() => setFull((v) => !v)}
            title={full ? '退出全屏（Esc）' : '全屏编辑，一屏放得下更多内容'}
          >
            {full ? '退出全屏' : '全屏'}
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

      {full ? (
        // 全屏：手机按 tab 只显示一半，宽屏左右并排（边写边看）
        <div className={`md-full-panes md-mode-${mode}`}>
          <div className="md-edit-wrap">
            <div
              ref={hlRef}
              className="md-highlight md-full-highlight"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
            <textarea
              ref={ref}
              className="md-full-input"
              value={value}
              autoFocus
              placeholder={placeholder}
              onChange={(e) => onChange(e.target.value)}
              onScroll={syncScroll}
            />
          </div>
          <div className="md-full-preview md-preview">
            {value.trim() ? <MarkdownView source={value} /> : <span className="muted">还没有内容</span>}
          </div>
        </div>
      ) : mode === 'edit' ? (
        <div className="md-edit-wrap">
          <div
            ref={hlRef}
            className="md-highlight"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
          <textarea
            ref={ref}
            className="md-input"
            rows={rows}
            value={value}
            autoFocus={autoFocus}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onScroll={syncScroll}
          />
        </div>
      ) : value.trim() ? (
        <div className="md-preview">
          <MarkdownView source={value} />
        </div>
      ) : (
        <div className="md-preview muted">还没有内容</div>
      )}

      <FilePickInput
        inputRef={fileRef}
        multiple
        accept="image/*,video/*,audio/*,.pdf,.txt,.md,.json"
        onFiles={(files) => void pick(files)}
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
