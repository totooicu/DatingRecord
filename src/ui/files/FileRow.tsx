// 单个文件行：
//   第一行 类型 + 预览/改名/引用/删除（缩略图也是预览入口）
//   第二行起 文件名：单独成行，长名字按需换行，绝不截断
//   最后一行 大小 · 时间 · 引用数
import { Fragment, useState, type ReactNode } from 'react';
import { countRefs, renameFile } from '../../core/repo/files';
import { ConfirmButton } from '../common';
import { bump } from '../../store';
import type { StoredFile } from '../../core/repo/files';
import { kindLabel, kindOf } from '../preview';
import { fmtDate, fmtSize } from './fileFormat';

/** 行内小图标：16px，跟随 currentColor */
const ICON = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="file-icon-btn"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function EyeIcon() {
  return (
    <svg {...ICON}>
      <path d="M2.6 12s3.5-6 9.4-6 9.4 6 9.4 6-3.5 6-9.4 6-9.4-6-9.4-6z" />
      <circle cx="12" cy="12" r="2.7" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg {...ICON}>
      <path d="M4 20h4L19.2 8.8a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M13.8 6.2l3 3" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg {...ICON}>
      <path d="M10 13.8a4 4 0 0 0 5.6 0l2.8-2.8a4 4 0 1 0-5.6-5.6L11.6 6.6" />
      <path d="M14 10.2a4 4 0 0 0-5.6 0l-2.8 2.8a4 4 0 1 0 5.6 5.6l1.2-1.2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...ICON} strokeWidth={2.6}>
      <path d="M5 12.5l4.6 4.6L19 6.8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg {...ICON}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5h5v2" />
      <path d="M6.5 7l.8 12.1a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** 文件名折行：优先在 _ - . / 空格后断行，避免把单词从中间劈开 */
function FileNameText({ name }: { name: string }) {
  const segments = name.split(/(?<=[_\-./\s])/);
  return (
    <>
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {seg}
          {i < segments.length - 1 && <wbr />}
        </Fragment>
      ))}
    </>
  );
}

export function FileRow({
  file,
  thumb,
  batch,
  selected,
  onToggleSelect,
  onPreview,
  onCopy,
  onDelete,
  onShowRefs,
  onPick,
}: {
  file: StoredFile;
  thumb?: string;
  batch: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onPreview: (f: StoredFile) => void;
  onCopy: (f: StoredFile) => void;
  onDelete: (f: StoredFile) => void;
  onShowRefs: (f: StoredFile) => void;
  /** 编辑器里的挑选模式：给了就在行内显示「插入」，点名字也直接插入 */
  onPick?: (f: StoredFile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.name);
  const refs = countRefs(file.id);
  const kind = kindOf(file.name, file.mime);

  /** 批量模式勾选、挑选模式插入，其余情况预览 */
  const openOrSelect = () => {
    if (batch) onToggleSelect(file.id);
    else if (onPick) onPick(file);
    else onPreview(file);
  };

  /** 回车/失焦保存，Esc 放弃；空名视为放弃（文件总得有个名字） */
  const commit = () => {
    const n = draft.trim();
    if (n && n !== file.name) {
      renameFile(file.id, n);
      // 引用处显示的是「按 id 现查的名字」，不 bump 的话旧名字会留在屏幕上
      bump();
    } else {
      setDraft(file.name);
    }
    setEditing(false);
  };

  return (
    <li className={selected ? 'file-item file-item-selected' : 'file-item'}>
      {batch && (
        <button
          type="button"
          className={selected ? 'file-check file-check-on' : 'file-check'}
          onClick={() => onToggleSelect(file.id)}
          aria-pressed={selected}
          aria-label={selected ? `取消选择「${file.name}」` : `选择「${file.name}」`}
        >
          {selected && <CheckIcon />}
        </button>
      )}

      <button
        className="file-thumb-btn"
        onClick={() => (batch ? onToggleSelect(file.id) : onPreview(file))}
        title={batch ? '选择' : '预览'}
        aria-label={batch ? '选择' : '预览'}
      >
        {thumb ? (
          <img className="file-thumb" src={thumb} alt="" />
        ) : (
          <span className="file-thumb file-thumb-icon">{kindLabel(kind).slice(0, 1)}</span>
        )}
      </button>

      <div className="file-main">
        <div className="file-row-top">
          <span className="file-type">{kindLabel(kind)}</span>

          {!batch && (
            <span className="file-actions">
              {onPick && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onPick(file)}>
                  插入
                </button>
              )}
              <IconButton label="预览" onClick={() => onPreview(file)}>
                <EyeIcon />
              </IconButton>
              <IconButton
                label="改名"
                onClick={() => {
                  setDraft(file.name);
                  setEditing(true);
                }}
              >
                <PencilIcon />
              </IconButton>
              <IconButton label="复制引用" onClick={() => onCopy(file)}>
                <LinkIcon />
              </IconButton>
              <ConfirmButton
                compact
                text="删除"
                icon={<TrashIcon />}
                className="file-icon-btn file-icon-btn-danger"
                danger
                confirmText={
                  refs > 0
                    ? `删除「${file.name}」？还有 ${refs} 个事件在正文里引用它，那些位置会显示成「附件已删除」。`
                    : `删除「${file.name}」？`
                }
                onConfirm={() => onDelete(file)}
              />
            </span>
          )}
        </div>

        {editing && !batch ? (
          <input
            className="file-rename"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(file.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            className="file-name"
            onClick={openOrSelect}
            title={onPick && !batch ? '插入引用' : file.name}
          >
            <FileNameText name={file.name} />
          </button>
        )}

        <div className="file-row-meta muted small">
          <span>{fmtSize(file.size)}</span>
          <span>·</span>
          <span>{fmtDate(file.createdAt)}</span>
          <span>·</span>
          {refs > 0 ? (
            <button type="button" className="file-refs-btn" onClick={() => onShowRefs(file)} title="查看引用它的事件">
              被 {refs} 个事件引用
            </button>
          ) : (
            <span>未被引用</span>
          )}
        </div>
      </div>
    </li>
  );
}
