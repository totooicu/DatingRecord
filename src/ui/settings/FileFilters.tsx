// 文件列表工具条：搜索、排序，以及可折叠的类型/时间/大小筛选。
import type { PreviewKind } from '../preview';
import { activeFilterCount, type FileFilter, type FileSort } from './fileFilter';

const TYPE_OPTIONS: { key: PreviewKind; label: string }[] = [
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'text', label: '文本' },
  { key: 'markdown', label: 'Markdown' },
  { key: 'unknown', label: '其他' },
];

const SORTS: { key: FileSort; label: string }[] = [
  { key: 'new', label: '最新上传' },
  { key: 'old', label: '最早上传' },
  { key: 'name', label: '名称 A→Z' },
  { key: 'size-desc', label: '大小：大到小' },
  { key: 'size-asc', label: '大小：小到大' },
];

export function FileFilters({
  filter,
  onChange,
  sort,
  onSort,
  open,
  onToggle,
  onReset,
  batch,
  onBatch,
}: {
  filter: FileFilter;
  onChange: (patch: Partial<FileFilter>) => void;
  sort: FileSort;
  onSort: (s: FileSort) => void;
  open: boolean;
  onToggle: () => void;
  onReset: () => void;
  batch: boolean;
  onBatch: () => void;
}) {
  const active = activeFilterCount(filter);

  const toggleType = (k: PreviewKind) => {
    const has = filter.types.includes(k);
    onChange({ types: has ? filter.types.filter((x) => x !== k) : [...filter.types, k] });
  };

  return (
    <>
      <div className="file-tools">
        <input
          type="search"
          className="file-search"
          value={filter.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="搜索文件名…"
          aria-label="搜索文件名"
        />
        <select
          className="file-sort"
          value={sort}
          onChange={(e) => onSort(e.target.value as FileSort)}
          aria-label="排序方式"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="file-filter-bar">
        <button
          type="button"
          className={open ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
          onClick={onToggle}
          aria-expanded={open}
        >
          筛选{active > 0 ? ` · ${active}` : ''}
        </button>
        <button
          type="button"
          className={batch ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
          onClick={onBatch}
        >
          {batch ? '退出批量' : '批量管理'}
        </button>
        {(filter.q || active > 0) && (
          <span className="muted small">
            已筛选{filter.types.length > 0 ? ` · ${filter.types.length} 种类型` : ''}
          </span>
        )}
      </div>

      {open && (
        <div className="file-filters">
          <div className="file-filter-group">
            <span className="file-filter-label">类型</span>
            <div className="chip-group">
              {TYPE_OPTIONS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={filter.types.includes(t.key) ? 'chip chip-on' : 'chip'}
                  onClick={() => toggleType(t.key)}
                  aria-pressed={filter.types.includes(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="file-filter-group">
            <span className="file-filter-label">时间</span>
            <input
              type="date"
              value={filter.from}
              max={filter.to || undefined}
              onChange={(e) => onChange({ from: e.target.value })}
              aria-label="开始日期"
            />
            <span className="muted small">至</span>
            <input
              type="date"
              value={filter.to}
              min={filter.from || undefined}
              onChange={(e) => onChange({ to: e.target.value })}
              aria-label="结束日期"
            />
          </div>

          <div className="file-filter-group">
            <span className="file-filter-label">大小</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={filter.minKB}
              onChange={(e) => onChange({ minKB: e.target.value })}
              placeholder="最小 KB"
              aria-label="最小大小（KB）"
            />
            <span className="muted small">~</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={filter.maxKB}
              onChange={(e) => onChange({ maxKB: e.target.value })}
              placeholder="最大 KB"
              aria-label="最大大小（KB）"
            />
          </div>

          <div className="file-filter-foot">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={onReset}
              disabled={active === 0 && !filter.q}
            >
              重置筛选
            </button>
          </div>
        </div>
      )}
    </>
  );
}
