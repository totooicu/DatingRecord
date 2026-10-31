// 事件集详情 → 表格阅览（F-C10）。
//
// 只读：表格回答「这个事件集里都有什么」，改内容仍然点进事件详情。
// 列是固定的八列，不在这一版做列显隐/自定义——先保证手机横向滑动能看全，
// 以及金额/评分能按原始数值排序（不是按格式化后的文本）。
import { useMemo, useState } from 'react';
import type { DREvent } from '../../core/types';
import { eventTableRows, type EventTableRow } from '../../core/repo/collections';
import type { CollectionView } from '../prefs';
import { EventViewToggle } from './EventViewToggle';

type SortKey = 'time' | 'title' | 'kind' | 'rating' | 'cost';

const COLUMNS: { key: SortKey | 'persons' | 'place' | 'tags'; label: string; num?: boolean }[] = [
  { key: 'title', label: '标题' },
  { key: 'time', label: '时间' },
  { key: 'kind', label: '类型' },
  { key: 'persons', label: '人物' },
  { key: 'place', label: '地点' },
  { key: 'tags', label: '标签' },
  { key: 'rating', label: '评分', num: true },
  { key: 'cost', label: '花费', num: true },
];

/** 表格里没有值的排最后；数字/时间按原始值比较 */
function sortValue(r: EventTableRow, key: SortKey): number | string {
  if (key === 'time') return r.startTs ?? Number.NEGATIVE_INFINITY;
  if (key === 'rating') return r.rating ?? Number.NEGATIVE_INFINITY;
  if (key === 'cost') return r.cost ?? Number.NEGATIVE_INFINITY;
  if (key === 'title') return r.title;
  return r.kindLabel;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

export function EventTable({
  events,
  view,
  onView,
  onOpen,
}: {
  events: DREvent[];
  view: CollectionView;
  onView: (v: CollectionView) => void;
  onOpen: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'time', desc: true });
  const rows = useMemo(() => eventTableRows(events), [events]);

  const sorted = useMemo(() => {
    const sign = sort.desc ? -1 : 1;
    return [...rows].sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb), 'zh-CN') * sign;
      }
      return (va - vb) * sign;
    });
  }, [rows, sort]);

  const totalCost = useMemo(
    () => rows.reduce((sum, r) => sum + (r.cost ?? 0), 0),
    [rows],
  );

  const clickSort = (key: SortKey) => {
    setSort((s) =>
      s.key === key
        ? { key, desc: !s.desc }
        : { key, desc: key === 'time' || key === 'rating' || key === 'cost' },
    );
  };

  return (
    <section className="card">
      <div className="card-head event-card-head">
        <h4 className="card-title">事件（{rows.length}）</h4>
        <EventViewToggle view={view} onChange={onView} />
      </div>
      {rows.length === 0 ? (
        <p className="muted">这个事件集还没有事件。</p>
      ) : (
        <>
          <p className="muted small ev-table-hint">只读 · 点标题查看；手机可左右滑动查看全部列</p>
          <div className="ev-table-wrap">
            <table className="ev-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => {
                    const sortable = c.key !== 'persons' && c.key !== 'place' && c.key !== 'tags';
                    const active = sortable && sort.key === c.key;
                    return (
                      <th key={c.key} className={c.num ? 'num' : undefined} aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                        {sortable ? (
                          <button type="button" className="ev-table-sort" onClick={() => clickSort(c.key as SortKey)}>
                            {c.label}
                            <span aria-hidden="true">{active ? (sort.desc ? ' ↓' : ' ↑') : ' ↕'}</span>
                          </button>
                        ) : (
                          c.label
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button type="button" className="ev-table-title" onClick={() => onOpen(r.id)}>
                        {r.title}
                      </button>
                    </td>
                    <td className="ev-table-time">{r.time}</td>
                    <td>{r.kindLabel}</td>
                    <td>{r.persons}</td>
                    <td>{r.place}</td>
                    <td className="ev-table-tags">{r.tags}</td>
                    <td className="num">{r.rating ?? ''}</td>
                    <td className="num">{r.cost != null ? `¥${fmtMoney(r.cost)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} className="muted small">共 {rows.length} 条</td>
                  <td className="num">¥{fmtMoney(totalCost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
