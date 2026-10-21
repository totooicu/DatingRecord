// 单个文件：三行布局
//   第一行 操作 + 预览（缩略图本身就是预览入口）
//   第二行 文件名（可原地改名）
//   第三行 大小 · 时间 · 引用数
import { useState } from 'react';
import { countRefs, renameFile } from '../../core/repo/files';
import { ConfirmButton } from '../common';
import { bump } from '../../store';
import type { StoredFile } from '../../core/repo/files';
import { kindLabel, kindOf } from '../preview';
import { fmtDate, fmtSize } from './fileFormat';

export function FileRow({
  file,
  thumb,
  onPreview,
  onCopy,
  onDelete,
}: {
  file: StoredFile;
  thumb?: string;
  onPreview: (f: StoredFile) => void;
  onCopy: (f: StoredFile) => void;
  onDelete: (f: StoredFile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.name);
  const refs = countRefs(file.id);
  const kind = kindOf(file.name, file.mime);

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
    <li className="file-item">
      <div className="file-row-top">
        <button className="file-thumb-btn" onClick={() => onPreview(file)} title="预览">
          {thumb ? (
            <img className="file-thumb" src={thumb} alt="" />
          ) : (
            <span className="file-thumb file-thumb-icon">{kindLabel(kind).slice(0, 1)}</span>
          )}
        </button>
        <span className="file-type">{kindLabel(kind)}</span>
        <span className="file-actions">
          <button className="btn btn-sm" onClick={() => onPreview(file)}>
            预览
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              setDraft(file.name);
              setEditing(true);
            }}
          >
            重命名
          </button>
          <button className="btn btn-sm" onClick={() => onCopy(file)}>
            复制引用
          </button>
          <ConfirmButton
            text="删除"
            danger
            confirmText={
              refs > 0
                ? `删除「${file.name}」？还有 ${refs} 处正文引用它，那些位置会显示成「附件已删除」。`
                : `删除「${file.name}」？`
            }
            onConfirm={() => onDelete(file)}
          />
        </span>
      </div>

      <div className="file-row-name">
        {editing ? (
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
          <button className="file-name" onClick={() => onPreview(file)} title={file.name}>
            {file.name}
          </button>
        )}
      </div>

      <div className="file-row-meta muted small">
        {fmtSize(file.size)} · {fmtDate(file.createdAt)}
        {refs > 0 ? ` · 被 ${refs} 处正文引用` : ' · 未被引用'}
      </div>
    </li>
  );
}
