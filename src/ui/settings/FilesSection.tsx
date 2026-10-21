import { useEffect, useMemo, useRef, useState } from 'react';
import { addFile, countRefs, deleteFile, fileRefSyntax, listFiles, urlForFile, type StoredFile } from '../../core/repo/files';
import { ConfirmButton } from '../common';
import { useVersion, bump } from '../../store';

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知时间';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 文件管理（单层，无文件夹）。
 *
 * 二进制存在 IndexedDB，库里只有元数据——所以「删除」要同时清两处，
 * 而「导出备份」需要临时把二进制转成 base64（见 core/io 的附件处理）。
 */
export function FilesSection() {
  const v = useVersion();
  const files = useMemo(() => listFiles(), [v]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [tip, setTip] = useState<string | null>(null);

  const key = files.map((f) => f.id).join(',');
  useEffect(() => {
    let alive = true;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        files
          .filter((f) => f.mime.startsWith('image/'))
          .map(async (f) => {
            const u = await urlForFile(f.id);
            if (u) next[f.id] = u;
          }),
      );
      if (alive) setThumbs(next);
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    try {
      for (const f of Array.from(list)) await addFile(f);
      bump();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const copyRef = async (f: StoredFile) => {
    const text = fileRefSyntax(f);
    try {
      await navigator.clipboard.writeText(text);
      setTip('已复制引用，粘贴到正文即可');
    } catch {
      setTip(text);
    }
  };

  return (
    <div>
      <div className="row-actions">
        <button className="btn btn-primary btn-sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? '上传中…' : '＋ 上传文件'}
        </button>
        <span className="muted small">
          {files.length} 个文件{files.length ? ` · ${fmtSize(files.reduce((s, f) => s + f.size, 0))}` : ''}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept="image/*,video/*,audio/*,.pdf,.txt,.md,.json"
        onChange={(e) => void upload(e.target.files)}
      />

      {files.length === 0 ? (
        <p className="muted">还没有文件。上传后可在事件正文里插入引用（编辑器工具栏的「插图」）。</p>
      ) : (
        <ul className="file-list">
          {files.map((f) => {
            const refs = countRefs(f.id);
            return (
              <li key={f.id} className="file-item">
                {thumbs[f.id] ? (
                  <img className="file-thumb" src={thumbs[f.id]} alt={f.name} />
                ) : (
                  <span className="file-thumb file-thumb-icon">{f.mime.startsWith('image/') ? '图' : '文'}</span>
                )}
                <span className="file-main">
                  <span className="file-name">{f.name}</span>
                  <span className="muted small">
                    {fmtSize(f.size)} · {fmtDate(f.createdAt)}
                    {refs > 0 ? ` · 被 ${refs} 处正文引用` : ' · 未被引用'}
                  </span>
                </span>
                <span className="member-actions">
                  <button className="btn btn-sm" onClick={() => void copyRef(f)}>
                    复制引用
                  </button>
                  <ConfirmButton
                    text="删除"
                    danger
                    confirmText={
                      refs > 0
                        ? `删除「${f.name}」？还有 ${refs} 处正文引用它，那些位置会显示成「附件已删除」。`
                        : `删除「${f.name}」？`
                    }
                    onConfirm={() => {
                      void deleteFile(f.id).then(() => bump());
                    }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {tip && <p className="muted small">{tip}</p>}
    </div>
  );
}
