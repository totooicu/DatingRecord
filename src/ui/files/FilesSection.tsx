// 文件管理（单层，无文件夹）。
//
// 二进制存在 IndexedDB，库里只有元数据——所以「删除」要同时清两处，
// 而「导出备份」需要临时把二进制转成 base64（见 core/io 的附件处理）。
//
// 正文引用存 file:<storedId>，方括号里另写一份文件名当展示名；
// 定位只看 id，所以这里改名不会让既有引用失效（显示名保持插入时的样子）。
import { useMemo, useState } from 'react';
import {
  countRefs,
  deleteFile,
  fileRefSyntax,
  listFiles,
  type StoredFile,
} from '../../core/repo/files';
import { useVersion, bump } from '../../store';
import { PreviewModal } from '../preview';
import { CollisionModal } from './CollisionModal';
import { MergeModal } from './MergeModal';
import { FileBatchBar } from './FileBatchBar';
import { FileFilters } from './FileFilters';
import { FileRefsModal } from './FileRefsModal';
import { MappingModal } from './MappingModal';
import { FileRow } from './FileRow';
import { useThumbs } from './useThumbs';
import { useUploader } from './useUploader';
import {
  applyFilter,
  DEFAULT_SORT,
  EMPTY_FILTER,
  type FileFilter,
  type FileSort,
} from './fileFilter';
import { fmtSize } from './fileFormat';

export function FilesSection({ onPick }: { onPick?: (f: StoredFile) => void }) {
  const v = useVersion();
  const files = useMemo(() => listFiles(), [v]);
  // 引用数排序要用：一次算好整张表，避免在 sort 的比较函数里反复查库
  const refCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const f of files) map[f.id] = countRefs(f);
    return map;
  }, [files]);
  const thumbs = useThumbs(files);
  const [tip, setTip] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [refsFile, setRefsFile] = useState<StoredFile | null>(null);
  const { busy, ask, inputRef, upload, openPicker } = useUploader(setTip);

  const [filter, setFilter] = useState<FileFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<FileSort>(DEFAULT_SORT);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [batch, setBatch] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [merge, setMerge] = useState<{ target: string; sources: string[] } | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);

  const visible = useMemo(
    () => applyFilter(files, filter, sort, refCounts),
    [files, filter, sort, refCounts],
  );
  const selectedVisible = visible.filter((f) => selected.has(f.id));
  const allSelected = visible.length > 0 && selectedVisible.length === visible.length;

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
    for (const id of ids) await deleteFile(id);
    setSelected(new Set());
    bump();
    setTip(`已删除 ${ids.length} 个文件`);
  };

  const totalSize = visible.reduce((s, f) => s + f.size, 0);

  return (
    <div>
      {onPick && <p className="muted small">点文件名或「插入」把引用写进正文；缩略图和眼睛图标仍是预览。</p>}
      <div className="row-actions">
        <button className="btn btn-primary btn-sm" onClick={openPicker} disabled={busy}>
          {busy ? '处理中…' : '＋ 上传文件'}
        </button>
        <button className="btn btn-sm" onClick={() => setMappingOpen(true)} disabled={busy}>
          ＋ 添加映射文件
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
        onToggle={() => {
          setFiltersOpen((x) => !x);
          setSortOpen(false);
        }}
        sortOpen={sortOpen}
        onToggleSort={() => {
          setSortOpen((x) => !x);
          setFiltersOpen(false);
        }}
        onReset={() => setFilter(EMPTY_FILTER)}
        batch={batch}
        onBatch={toggleBatch}
      />

      {batch && (
        <FileBatchBar
          count={selectedVisible.length}
          total={visible.length}
          allSelected={allSelected}
          targetName={selectedVisible[0]?.name}
          onToggleAll={toggleAll}
          onMerge={() =>
            setMerge({ target: selectedVisible[0].id, sources: selectedVisible.slice(1).map((f) => f.id) })
          }
          onDelete={() => void removeSelected()}
        />
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
              onShowRefs={setRefsFile}
              onPick={onPick}
            />
          ))}
        </ul>
      )}

      {tip && <p className="muted small">{tip}</p>}
      {previewId && <PreviewModal file={files.find((f) => f.id === previewId)!} onClose={() => setPreviewId(null)} />}
      {refsFile && (
        <FileRefsModal
          file={refsFile}
          onClose={() => setRefsFile(null)}
        />
      )}
      {merge && (
        <MergeModal
          targetId={merge.target}
          sourceIds={merge.sources}
          onClose={() => setMerge(null)}
          onDone={(m) => {
            setSelected(new Set());
            setTip(m);
          }}
        />
      )}
      {mappingOpen && (
        <MappingModal
          onClose={() => setMappingOpen(false)}
          onSaved={(text) => {
            setTip(text);
            bump();
          }}
          onSaveEntity={(file) => {
            // 下载好的实体走正常上传：判重、顺延序号、落 IndexedDB 都不另起一套
            setMappingOpen(false);
            void upload([file]);
          }}
        />
      )}
      {ask && (
        <CollisionModal
          prompt={ask.prompt}
          uploading={ask.preview}
          onDecide={(pick) => ask.step(pick)}
          onCancel={ask.cancel}
        />
      )}
    </div>
  );
}
