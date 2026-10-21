// 文件管理（单层，无文件夹）。
//
// 二进制存在 IndexedDB，库里只有元数据——所以「删除」要同时清两处，
// 而「导出备份」需要临时把二进制转成 base64（见 core/io 的附件处理）。
//
// 正文引用只存 file:<id>，不存文件名，所以这里改名不会影响任何既有引用。
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addFile,
  deleteFile,
  fileRefSyntax,
  listFiles,
  urlForFile,
  type StoredFile,
} from '../../core/repo/files';
import { useVersion, bump } from '../../store';
import { PreviewModal } from '../preview';
import { FileRow } from './FileRow';
import { fmtSize } from './fileFormat';

export function FilesSection() {
  const v = useVersion();
  const files = useMemo(() => listFiles(), [v]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [tip, setTip] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

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

  const remove = (f: StoredFile) => {
    void deleteFile(f.id).then(() => bump());
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
        accept="*/*"
        onChange={(e) => void upload(e.target.files)}
      />

      {files.length === 0 ? (
        <p className="muted">还没有文件。上传后可在事件正文里插入引用（编辑器工具栏的「插图」）。</p>
      ) : (
        <ul className="file-list">
          {files.map((f) => (
            <FileRow
              key={f.id}
              file={f}
              thumb={thumbs[f.id]}
              onPreview={(x) => setPreviewId(x.id)}
              onCopy={copyRef}
              onDelete={remove}
            />
          ))}
        </ul>
      )}
      {tip && <p className="muted small">{tip}</p>}
      {previewId && <PreviewModal file={files.find((f) => f.id === previewId)!} onClose={() => setPreviewId(null)} />}
    </div>
  );
}
