import { useEffect, useMemo, useState } from 'react';
import { EVENT_KINDS } from '../../core/repo/events';
import { listPersons } from '../../core/repo/persons';
import { flattenTree, getTree } from '../../core/repo/collections';
import { useVersion } from '../../store';
import type { TimelineFilter } from './filter';
import { defaultFilter } from './filter';

export function TimelineFilters({
  filter,
  onChange,
}: {
  filter: TimelineFilter;
  onChange: (f: TimelineFilter) => void;
}) {
  const v = useVersion();
  const [filtersOpen, setFiltersOpen] = useState(false);
  /**
   * wide 由 CSS 断点驱动：宽屏常驻展开，折叠按钮隐藏。
   * 用一个 matchMedia 订阅让 DOM 结构与视觉保持一致，避免「按钮写着展开但面板已显示」。
   */
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const fn = () => setWide(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  const open = wide || filtersOpen;
  const persons = useMemo(() => listPersons({ includeArchived: true }), [v]);
  const flat = useMemo(() => flattenTree(getTree()), [v]);

  const set = (patch: Partial<TimelineFilter>) => onChange({ ...filter, ...patch });
  const activeCount = [
    filter.keyword,
    filter.personId,
    filter.collectionId,
    filter.kind,
    filter.minRating,
    filter.withinDays,
    filter.tag,
  ].filter(Boolean).length;

  return (
    <div className={!wide && !filtersOpen ? 'pane-body' : 'pane-body filters-open'}>
      {/* 手机端折叠；宽屏常驻展开并隐藏折叠按钮（由 matchMedia 驱动的 wide 决定） */}
      <button
        className={wide ? 'filter-toggle filter-toggle-hidden' : 'filter-toggle'}
        onClick={() => setFiltersOpen((s) => !s)}
      >
        <span>
          筛选{activeCount > 0 && <em className="filter-count">{activeCount}</em>}
        </span>
        <span className="filter-caret">{open ? '收起' : '展开'}</span>
      </button>
      <div className="filter-inner">
        <div className="pane-head filter-head">
          <strong>筛选</strong>
          <button className="icon-btn" onClick={() => onChange(defaultFilter)} title="重置">
            ↺
          </button>
        </div>
        <div className="filter-body">
          <label className="filter-item">
            <span>关键词</span>
            <input
              type="search"
              value={filter.keyword}
              placeholder="标题、地点、备注、标签"
              onChange={(e) => set({ keyword: e.target.value })}
            />
          </label>
          <label className="filter-item">
            <span>人物</span>
            <select value={filter.personId} onChange={(e) => set({ personId: e.target.value })}>
              <option value="">全部</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-item">
            <span>事件集</span>
            <select value={filter.collectionId} onChange={(e) => set({ collectionId: e.target.value })}>
              <option value="">全部</option>
              {flat.map((f) => (
                <option key={f.id} value={f.id}>
                  {'　'.repeat(f.depth)}
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-item">
            <span>类型</span>
            <select value={filter.kind} onChange={(e) => set({ kind: e.target.value })}>
              <option value="">全部</option>
              {EVENT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-item">
            <span>评分 ≥</span>
            <select value={filter.minRating} onChange={(e) => set({ minRating: e.target.value })}>
              <option value="">不限</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={String(n)}>
                  {n} 星
                </option>
              ))}
            </select>
          </label>
          <label className="filter-item">
            <span>时间范围</span>
            <select value={filter.withinDays} onChange={(e) => set({ withinDays: e.target.value })}>
              <option value="">全部</option>
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
              <option value="90">近 90 天</option>
              <option value="365">近一年</option>
            </select>
          </label>
          <label className="filter-item">
            <span>标签包含</span>
            <input value={filter.tag} onChange={(e) => set({ tag: e.target.value })} placeholder="如：电影" />
          </label>
        </div>
      </div>
    </div>
  );
}
