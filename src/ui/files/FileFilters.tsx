// 文件列表工具条：搜索、排序，以及可折叠的类型/时间/大小筛选。
import type { PreviewKind } from '../preview';
import {
  activeFilterCount,
  type FileFilter,
  type FileSort,
  type FileSortKey,
} from './fileFilter';

const TYPE_OPTIONS: { key: PreviewKind; label: string }[] = [
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'text', label: '文本' },
  { key: 'markdown', label: 'Markdown' },
  { key: 'unknown', label: '其他' },
];

const SORT_FIELDS: { key: FileSortKey; label: string }[] = [
  { key: 'time', label: '上传时间' },
  { key: 'name', label: '名称' },
  { key: 'size', label: '大小' },
  { key: 'refs', label: '引用数量' },
];

/** 「顺序 / 逆序」对不同字段的含义不一样，直接写成人话 */
const DIR_HINT: Record<FileSortKey, Record<FileSort['dir'], string>> = {
  time: { asc: '最早在前', desc: '最新在前' },
  name: { asc: 'A → Z', desc: 'Z → A' },
  size: { asc: '小到大', desc: '大到小' },
  refs: { asc: '少到多', desc: '多到少' },
};

export function FileFilters({
  filter,
  onChange,
  sort,
  onSort,
  open,
  onToggle,
  sortOpen,
  onToggleSort,
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
  sortOpen: boolean;
  onToggleSort: () => void;
  onReset: () => void;
  batch: boolean;
  onBatch: () => void;
}) {
  const active = activeFilterCount(filter);
  const sortLabel = SORT_FIELDS.find((s) => s.key === sort.key)?.label ?? '上传时间';

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
          className={sortOpen ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
          onClick={onToggleSort}
          aria-expanded={sortOpen}
        >
          排序 · {sortLabel}
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

      {sortOpen && (
        <div className="file-sorts">
          <div className="file-filter-group">
            <span className="file-filter-label">排序</span>
            <div className="chip-group">
              {SORT_FIELDS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={sort.key === s.key ? 'chip chip-on' : 'chip'}
                  onClick={() => onSort({ ...sort, key: s.key })}
                  aria-pressed={sort.key === s.key}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="file-filter-group">
            <span className="file-filter-label">方向</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
              aria-label={sort.dir === 'asc' ? '切换为逆序' : '切换为顺序'}
            >
              {sort.dir === 'asc' ? '顺序 ↑' : '逆序 ↓'}
            </button>
            <span className="muted small">{DIR_HINT[sort.key][sort.dir]}</span>
          </div>
        </div>
      )}

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
