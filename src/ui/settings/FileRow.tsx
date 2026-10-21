// 单个文件行：缩略图 + 名字（可原地改名）+ 引用数 + 操作
import { useState } from 'react';
import { countRefs, renameFile } from '../../core/repo/files';
import { ConfirmButton } from '../common';
import { bump } from '../../store';
import type { StoredFile } from '../../core/repo/files';
import { fmtDate, fmtSize } from './fileFormat';

export function FileRow({
  file,
  thumb,
  onCopy,
  onDelete,
}: {
  file: StoredFile;
  thumb?: string;
  onCopy: (f: StoredFile) => void;
  onDelete: (f: StoredFile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.name);
  const refs = countRefs(file.id);

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
      {thumb ? (
        <img className="file-thumb" src={thumb} alt={file.name} />
      ) : (
        <span className="file-thumb file-thumb-icon">{file.mime.startsWith('image/') ? '图' : '文'}</span>
      )}
      <span className="file-main">
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
          <span className="file-name">{file.name}</span>
        )}
        <span className="muted small">
          {fmtSize(file.size)} · {fmtDate(file.createdAt)}
          {refs > 0 ? ` · 被 ${refs} 处正文引用` : ' · 未被引用'}
        </span>
      </span>
      <span className="member-actions">
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
    </li>
  );
}
