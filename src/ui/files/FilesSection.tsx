// 文件管理（单层，无文件夹）。
//
// 二进制存在 IndexedDB，库里只有元数据——所以「删除」要同时清两处，
// 而「导出备份」需要临时把二进制转成 base64（见 core/io 的附件处理）。
//
// 正文引用存 file:<storedId>，方括号里另写一份文件名当展示名；
// 定位只看 id，所以这里改名不会让既有引用失效（显示名保持插入时的样子）。
import { useMemo, useState, type ReactNode } from 'react';
import {
  countTotalRefs,
  deleteFile,
  fileRefSyntax,
  listFiles,
  type StoredFile,
} from '../../core/repo/files';
import { useVersion, bump } from '../../store';
import { FilePickInput } from '../common';
import { PreviewModal } from '../preview';
import { kindOf, type PreviewKind } from '../preview/kind';
import { CollisionModal } from './CollisionModal';
import { MergeModal } from './MergeModal';
import { FileBatchBar } from './FileBatchBar';
import { FileFilters } from './FileFilters';
import { FileRefsModal } from './FileRefsModal';
import { MappingModal } from './MappingModal';
import { DupHashSection } from './DupHashSection';
import { DupNameSection } from './DupNameSection';
import { FileHealthSection } from './FileHealthSection';
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

export function FilesSection({
  onPick,
  pickedIds,
  onlyKinds,
  pickLabel,
  compact,
  maintenance,
}: {
  maintenance?: ReactNode;
  onPick?: (f: StoredFile) => void;
  pickedIds?: Set<string>;
  /** 挑选模式只列这些类型（如音乐面板只列音频） */
  onlyKinds?: PreviewKind[];
  /** 挑选按钮文案（默认「插入」） */
  pickLabel?: string;
  /** 紧凑挑选：不显示上传/映射/筛选/批量，只留文件列表 */
  compact?: boolean;
}) {
  const v = useVersion();
  const files = useMemo(() => {
    const all = listFiles();
    return onlyKinds && onlyKinds.length
      ? all.filter((f) => onlyKinds.includes(kindOf(f.name, f.mime)))
      : all;
  }, [v, onlyKinds]);
  // 引用数排序/筛选要用：一次算好整张表，避免在比较函数里反复查库。
  // 口径与行尾「未被引用」一致：事件 + 头像/图标 + 集图标
  const refCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const f of files) map[f.id] = countTotalRefs(f);
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
  const [tab, setTab] = useState<'files' | 'maintenance'>('files');
  const [maintenanceVisited, setMaintenanceVisited] = useState(false);

  // 折叠标题上的组数，口径与面板里的「待处理」一致：
  // 同一个 hash 下挂着 ≥2 条，且至少有一条没被标记成「不同内容」
  // （标了的那条已经退出判重候选，没标的还在会不断弹窗，所以仍算待处理）。
  // 纯内存统计，不查库 —— 收起时不该为面板的开销买单。
  const dupGroups = useMemo(() => {
    const seen = new Map<string, { total: number; plain: number }>();
    for (const f of files) {
      if (!f.sha256 || f.sourceUrl) continue;
      const g = seen.get(f.sha256) ?? { total: 0, plain: 0 };
      g.total++;
      if (!f.hashShared) g.plain++;
      seen.set(f.sha256, g);
    }
    let n = 0;
    for (const g of seen.values()) if (g.total > 1 && g.plain > 0) n++;
    return n;
  }, [files]);

  /** 从重复 hash 面板跳过来：把这个 hash 变成当前搜索词，列表只剩这一组 */
  const searchByHash = (sha: string) => {
    setFilter((f) => ({ ...f, q: sha }));
    setTab('files');
    setTip('已把这组的 hash 填进搜索框，列表只剩这几条；清空搜索框就回到全部');
  };

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
      {!compact && <div className="aichat-tabs" role="tablist" aria-label="文件切页">
        <button type="button" role="tab" aria-selected={tab === 'files'} className={`aichat-tab${tab === 'files' ? ' aichat-tab-on' : ''}`} onClick={() => setTab('files')}>文件</button>
        <button type="button" role="tab" aria-selected={tab === 'maintenance'} className={`aichat-tab${tab === 'maintenance' ? ' aichat-tab-on' : ''}`} onClick={() => { setMaintenanceVisited(true); setTab('maintenance'); }}>整理{dupGroups > 0 && <span className="aichat-tab-n">{dupGroups}</span>}</button>
      </div>}
      <div hidden={!compact && tab !== 'files'}>
      {onPick && !compact && <p className="muted small">点文件名或「插入」把引用写进正文；缩略图和眼睛图标仍是预览。</p>}
      {!compact && (
        <>
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
          <FilePickInput inputRef={inputRef} accept="*/*" multiple onFiles={(files) => void upload(files)} />

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


        </>
      )}

      {compact && (
        <p className="muted small">
          {files.length ? `文件库里 ${files.length} 首音频` : '文件库里还没有音频'}
        </p>
      )}

      {files.length === 0 ? (
        <p className="muted">
          {compact ? '文件库里还没有音频。先用上面的「从本地添加」上传。' : '还没有文件。上传后可在事件正文里插入引用（编辑器工具栏的「插图」）。'}
        </p>
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
              pickDisabled={pickedIds?.has(f.id)}
              pickLabel={pickLabel}
            />
          ))}
        </ul>
      )}

      </div>
      {!compact && <div hidden={tab !== 'maintenance'}>
        {maintenanceVisited && <>
          <section className="files-advanced dup-entry">
            <h4>重复 hash 管理{dupGroups > 0 ? ` · ${dupGroups} 组待处理` : ''}</h4>
            <DupHashSection onSearchHash={searchByHash} onDone={setTip} />
          </section>
          <DupNameSection onMerge={(ids) => setMerge({ target: ids[0], sources: ids.slice(1) })} />
          <FileHealthSection files={files} />
          {maintenance}
        </>}
      </div>}
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
          onDecide={(choice) => ask.step(choice)}
          onCancel={ask.cancel}
        />
      )}
    </div>
  );
}
