// 属性变化：timeVarying 字段的历史。数值型画曲线，其余列时间轴。
import { useMemo, useState } from 'react';
import { listAttrHistory } from '../../core/repo/persons';
import { formatAttrValue } from '../attr';
import { HistoryChart, type ChartPoint } from './HistoryChart';
import { useVersion } from '../../store';
import { relativeDays, toTs, formatCompact } from '../../core/time';
import type { AttributeDef } from '../../core/types';

interface Entry {
  value: unknown;
  changedAt: string;
  reason: string | null;
}

const CHARTABLE = ['number', 'money', 'rating'];

/** 默认选中项：优先能画曲线的字段里最新变过的，否则全局最新变的 */
function pickDefault(byKey: Map<string, Entry[]>, defs: AttributeDef[]): string {
  let best: string | null = null;
  let bestAt = '';
  let any: string | null = null;
  let anyAt = '';
  for (const [k, list] of byKey) {
    const at = list[list.length - 1].changedAt;
    if (at > anyAt) {
      anyAt = at;
      any = k;
    }
    const d = defs.find((x) => x.key === k);
    if (d && CHARTABLE.includes(d.type) && at > bestAt) {
      bestAt = at;
      best = k;
    }
  }
  return best ?? any ?? [...byKey.keys()][0];
}

export function AttrHistory({ personId, defs }: { personId: string; defs: AttributeDef[] }) {
  const v = useVersion();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  const byKey = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const r of listAttrHistory(personId)) {
      let value: unknown = null;
      try {
        value = JSON.parse(r.valueJson);
      } catch {
        value = r.valueJson;
      }
      const list = map.get(r.key) ?? [];
      list.push({ value, changedAt: r.changedAt, reason: r.reason });
      map.set(r.key, list);
    }
    return map;
  }, [personId, v]);

  const keys = useMemo(() => [...byKey.keys()], [byKey]);
  const latest = useMemo(() => {
    let out: { key: string; changedAt: string } | null = null;
    for (const [k, list] of byKey) {
      const at = list[list.length - 1].changedAt;
      if (!out || at > out.changedAt) out = { key: k, changedAt: at };
    }
    return out;
  }, [byKey]);

  if (keys.length === 0) return null;

  const key = active && byKey.has(active) ? active : pickDefault(byKey, defs);
  const def = defs.find((d) => d.key === key);
  const entries = byKey.get(key) ?? [];
  const points: ChartPoint[] = entries.map((e) => ({ changedAt: e.changedAt, value: e.value }));

  return (
    <section className="card">
      <div className="card-head">
        <button className="hist-toggle" aria-expanded={open} onClick={() => setOpen((s) => !s)}>
          <h4 className="card-title">属性变化（{keys.length} 项）</h4>
          <span className="hist-sub">
            {latest && `最近 ${relativeDays(latest.changedAt) ?? '时间未知'} · ${defs.find((d) => d.key === latest.key)?.label ?? latest.key}`}
          </span>
          <em className="hist-caret">{open ? '▾' : '▸'}</em>
        </button>
      </div>

      {open && (
        <div className="hist-body">
          <div className="chip-group">
            {keys.map((k) => (
              <button
                key={k}
                type="button"
                className={k === key ? 'chip chip-on' : 'chip'}
                onClick={() => setActive(k)}
              >
                {defs.find((d) => d.key === k)?.label ?? k}
              </button>
            ))}
          </div>

          {def ? (
            <>
              <HistoryChart def={def} points={points} />
              <ol className="hist-list">
                {[...entries].reverse().map((e, i) => (
                  <li key={`${e.changedAt}-${i}`}>
                    <span className="hist-time">{formatCompact(toTs(e.changedAt), true)}</span>
                    <span className="hist-val-text">{e.value === null ? '（清空）' : formatAttrValue(def, e.value)}</span>
                    {e.reason && <span className="hist-reason">{e.reason}</span>}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="muted">该字段的定义已不存在，仅保留历史值。</p>
          )}
        </div>
      )}
    </section>
  );
}
