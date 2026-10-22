// 日历筛选：人物、事件集各多选。
//
// 为什么用弹窗而不是下拉：手机宽度只有 390px，多选列表塞进下拉会变成
// 一个又窄又能滚的小格子；弹窗能把层级（事件集缩进）和勾选状态摆清楚。
//
// 语义见 core/calendar.ts 的 CalendarFilter：组内 OR、组间 AND。
import { useMemo, useState } from 'react';
import { EMPTY_CALENDAR_FILTER, isCalendarFilterActive, type CalendarFilter } from '../../core/calendar';
import { getTree, flattenTree } from '../../core/repo/collections';
import { listPersons } from '../../core/repo/persons';
import { useVersion } from '../../store';
import { Modal } from '../common';

export function CalendarFilters({
  filter,
  onChange,
}: {
  filter: CalendarFilter;
  onChange: (next: CalendarFilter) => void;
}) {
  const v = useVersion();
  const [open, setOpen] = useState<'person' | 'collection' | null>(null);

  const persons = useMemo(() => listPersons(), [v]);
  // 根集合不列：勾它等于「全部」，跟不筛选一样，只会让人困惑
  const nodes = useMemo(() => flattenTree(getTree()).filter((n) => n.depth > 0), [v]);

  const personNames = new Map(persons.map((p) => [p.id, p.displayName]));
  const nodeNames = new Map(nodes.map((n) => [n.id, n.name]));

  const summarize = (ids: string[], names: Map<string, string>, all: string) => {
    if (ids.length === 0) return all;
    const first = names.get(ids[0]) ?? '已删除';
    return ids.length === 1 ? first : `${first} +${ids.length - 1}`;
  };

  const active = isCalendarFilterActive(filter);

  return (
    <>
      <div className="cal-filters">
        <button
          type="button"
          className={filter.personIds.length ? 'cal-filter-btn cal-filter-btn-on' : 'cal-filter-btn'}
          onClick={() => setOpen('person')}
        >
          人物 · {summarize(filter.personIds, personNames, '全部')}
        </button>
        <button
          type="button"
          className={filter.collectionIds.length ? 'cal-filter-btn cal-filter-btn-on' : 'cal-filter-btn'}
          onClick={() => setOpen('collection')}
        >
          事件集 · {summarize(filter.collectionIds, nodeNames, '全部')}
        </button>
        {active && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(EMPTY_CALENDAR_FILTER)}>
            清除
          </button>
        )}
      </div>

      {open === 'person' && (
        <MultiPick
          title="只看这些人物"
          empty="还没有人物"
          rows={persons.map((p) => ({ id: p.id, name: p.displayName, depth: 0 }))}
          selected={filter.personIds}
          onToggle={(id) => onChange({ ...filter, personIds: toggle(filter.personIds, id) })}
          onClear={() => onChange({ ...filter, personIds: [] })}
          onClose={() => setOpen(null)}
        />
      )}

      {open === 'collection' && (
        <MultiPick
          title="只看这些事件集"
          empty="还没有事件集"
          rows={nodes.map((n) => ({ id: n.id, name: n.name, depth: n.depth }))}
          selected={filter.collectionIds}
          onToggle={(id) => onChange({ ...filter, collectionIds: toggle(filter.collectionIds, id) })}
          onClear={() => onChange({ ...filter, collectionIds: [] })}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function toggle(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

function MultiPick({
  title,
  empty,
  rows,
  selected,
  onToggle,
  onClear,
  onClose,
}: {
  title: string;
  empty: string;
  rows: { id: string; name: string; depth: number }[];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" disabled={selected.length === 0} onClick={onClear}>
            清空
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            完成
          </button>
        </>
      }
    >
      {rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="cal-filter-list">
          {rows.map((r) => (
            <label key={r.id} className="cal-filter-row" style={{ paddingLeft: 8 + r.depth * 14 }}>
              <input type="checkbox" checked={selected.includes(r.id)} onChange={() => onToggle(r.id)} />
              <span className="cal-filter-name">{r.name}</span>
            </label>
          ))}
        </div>
      )}
      <p className="muted small">可以多选：组内任选其一即匹配；同时选了人物和事件集时，两个条件都要满足。</p>
    </Modal>
  );
}
