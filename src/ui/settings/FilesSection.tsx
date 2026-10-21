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
import { ConfirmButton } from '../common';
import { PreviewModal } from '../preview';
import { FileFilters } from './FileFilters';
import { FileRow } from './FileRow';
import { applyFilter, EMPTY_FILTER, type FileFilter, type FileSort } from './fileFilter';
import { fmtSize } from './fileFormat';

export function FilesSection() {
  const v = useVersion();
  const files = useMemo(() => listFiles(), [v]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [tip, setTip] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const [filter, setFilter] = useState<FileFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<FileSort>('new');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [batch, setBatch] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visible = useMemo(() => applyFilter(files, filter, sort), [files, filter, sort]);
  const selectedVisible = visible.filter((f) => selected.has(f.id));
  const allSelected = visible.length > 0 && selectedVisible.length === visible.length;

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

  const toggleBatch = () => {
    setBatch((b) => !b);
    setSelected(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) visible.forEach((f) => next.delete(f.id));
    else visible.forEach((f) => next.add(f.id));
    setSelected(next);
  };

  const removeSelected = async () => {
    const ids = selectedVisible.map((f) => f.id);
    if (!ids.length) return;
    setBusy(true);
    try {
      for (const id of ids) await deleteFile(id);
      setSelected(new Set());
      bump();
    } finally {
      setBusy(false);
    }
  };

  const totalSize = visible.reduce((s, f) => s + f.size, 0);

  return (
    <div>
      <div className="row-actions">
        <button className="btn btn-primary btn-sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? '处理中…' : '＋ 上传文件'}
        </button>
        <span className="muted small">
          {visible.length === files.length
            ? `${files.length} 个文件`
            : `匹配 ${visible.length} / ${files.length} 个文件`}
          {visible.length ? ` · ${fmtSize(totalSize)}` : ''}
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

      <FileFilters
        filter={filter}
        onChange={(patch) => setFilter((f) => ({ ...f, ...patch }))}
        sort={sort}
        onSort={setSort}
        open={filtersOpen}
        onToggle={() => setFiltersOpen((x) => !x)}
        onReset={() => setFilter(EMPTY_FILTER)}
        batch={batch}
        onBatch={toggleBatch}
      />

      {batch && (
        <div className="file-batch-bar">
          <button className="btn btn-sm" onClick={toggleAll} disabled={visible.length === 0}>
            {allSelected ? '取消全选' : '全选'}
          </button>
          <span className="muted small">已选 {selectedVisible.length} 个</span>
          {selectedVisible.length > 0 ? (
            <ConfirmButton
              compact
              danger
              className="btn-sm"
              text={`删除选中 (${selectedVisible.length})`}
              confirmText={`删除选中的 ${selectedVisible.length} 个文件？正文里的引用会显示成「附件已删除」。`}
              onConfirm={() => void removeSelected()}
            />
          ) : (
            <button className="btn btn-sm" disabled>
              删除选中
            </button>
          )}
        </div>
      )}

      {files.length === 0 ? (
        <p className="muted">还没有文件。上传后可在事件正文里插入引用（编辑器工具栏的「插图」）。</p>
      ) : visible.length === 0 ? (
        <div className="empty">
          <p>没有匹配的文件</p>
          <button className="btn btn-sm" onClick={() => setFilter(EMPTY_FILTER)}>
            清除筛选
          </button>
        </div>
      ) : (
        <ul className="file-list">
          {visible.map((f) => (
            <FileRow
              key={f.id}
              file={f}
              thumb={thumbs[f.id]}
              batch={batch}
              selected={selected.has(f.id)}
              onToggleSelect={toggleSelect}
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
