// 示例数据与重置
//
// 两块内容：
//   1. 精选示例：25 条手写事件，用来看懂这个应用怎么用；
//   2. 压测数据：按数量级造（10 / 100 / 1000 / 10000），每一项的数量都能单独改，
//      文本长度也会跟着量级放大——看的就是极端数据量下界面还跑不跑得动。
import { useState } from 'react';
import { clearAllData } from '../../core/io';
import { persist } from '../../core/db';
import { loadSampleData } from '../../core/seed';
import {
  loadBulkData,
  planFor,
  estimateRows,
  SCALE_TIERS,
  type BulkPlan,
  type BulkProgress,
  type ScaleTier,
} from '../../core/seed/bulk';
import { TEXT_SCALE_LABEL, type TextScale } from '../../core/seed/corpus';
import { ConfirmButton } from '../common';
import { Section } from './Section';
import { bump } from '../../store';

type Field = { key: keyof BulkPlan; label: string; hint?: string; min: number; max: number };

const FIELDS: Field[] = [
  { key: 'persons', label: '人物', min: 1, max: 10000 },
  { key: 'collections', label: '事件集', min: 1, max: 10000 },
  { key: 'events', label: '事件', min: 1, max: 10000 },
  { key: 'files', label: '文件', hint: '要写二进制，最多 1000', min: 0, max: 1000 },
  { key: 'points', label: '定位点', min: 0, max: 50000 },
  { key: 'playlists', label: '歌单', min: 0, max: 500 },
  { key: 'tracksPerPlaylist', label: '曲目 / 单', min: 0, max: 500 },
  { key: 'chatPerEvent', label: '聊天 / 事件', hint: '0 = 不生成', min: 0, max: 50 },
  { key: 'collectionsPerEvent', label: '事件集 / 事件', min: 0, max: 10 },
];

function fmt(n: number): string {
  return n.toLocaleString('zh-CN');
}

export function SampleSection() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [tier, setTier] = useState<ScaleTier>(100);
  const [plan, setPlan] = useState<BulkPlan>(() => planFor(100));
  const [detail, setDetail] = useState(false);
  const [prog, setProg] = useState<BulkProgress | null>(null);

  const patch = (p: Partial<BulkPlan>) => setPlan((prev) => ({ ...prev, ...p }));

  const chooseTier = (t: ScaleTier) => {
    setTier(t);
    setPlan(planFor(t));
  };

  return (
    <Section
      title="示例数据与重置"
      desc="「精选示例」会铺开 25 条手写事件：咖啡店、影院、美术馆、书店、公园、火锅店、Livehouse、游乐园……外加一套回忆录和一份定位记录，方便快速看到各种场景下的效果。「压测数据」按数量级造，用来看极端数据量下的表现。"
    >
      <div className="row-actions">
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg('');
            try {
              const r = await loadSampleData();
              bump();
              setMsg(
                `已创建 ${r.persons} 位人物、${r.events} 条事件、${r.collections} 个事件集、` +
                  `${r.memoirs} 套回忆录、${r.files} 个附件。`,
              );
            } catch (e) {
              setMsg(`载入失败：${e instanceof Error ? e.message : String(e)}`);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '正在载入…' : '载入精选示例（25 条）'}
        </button>
        <ConfirmButton
          text="清空全部数据"
          danger
          confirmText="确认清空？建议先导出备份！"
          onConfirm={async () => {
            await clearAllData();
            await persist(); // 必须先落盘再刷新，否则 debounce 未触发会「清不掉」
            location.reload();
          }}
        />
      </div>

      <div className="sample-divider" />

      <h4 className="sample-sub">压测数据（按数量级造）</h4>
      <p className="muted small">
        选一个数量级，各项数量会自动跟着派生，也可以展开逐项改到想要的值。
        文本长度会随量级一起放大——人名、标题、正文、文件名都会变长，
        极端档位还会造出无空格的超长文件名，顺带试界面会不会被顶宽。
      </p>

      <div className="theme-mode sample-tier">
        {SCALE_TIERS.map((t) => (
          <button
            key={t}
            type="button"
            className={t === tier ? 'theme-mode-btn on' : 'theme-mode-btn'}
            disabled={busy}
            onClick={() => chooseTier(t)}
          >
            {fmt(t)}
          </button>
        ))}
      </div>

      <div className="sample-estimate muted small">
        预估写入约 <strong>{fmt(estimateRows(plan))}</strong> 行（人物 {fmt(plan.persons)} · 事件{' '}
        {fmt(plan.events)} · 事件集 {fmt(plan.collections)} · 文件 {fmt(plan.files)} · 定位点{' '}
        {fmt(plan.points)} · 歌单 {fmt(plan.playlists)} × {fmt(plan.tracksPerPlaylist)} 首）
      </div>

      <button type="button" className="btn sample-toggle" disabled={busy} onClick={() => setDetail(!detail)}>
        {detail ? '收起各项数量' : '调整各项数量'}
      </button>

      {detail && (
        <div className="sample-grid">
          {FIELDS.map((f) => (
            <label key={f.key} className="sample-field">
              <span>
                {f.label}
                {f.hint && <em className="sample-hint"> {f.hint}</em>}
              </span>
              <input
                type="number"
                min={f.min}
                max={f.max}
                value={plan[f.key] as number}
                disabled={busy}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isNaN(v)) return;
                  patch({ [f.key]: Math.max(f.min, Math.min(f.max, v)) } as Partial<BulkPlan>);
                }}
              />
            </label>
          ))}
          <label className="sample-field">
            <span>文本长度</span>
            <select
              value={plan.textScale}
              disabled={busy}
              onChange={(e) => patch({ textScale: Number(e.target.value) as TextScale })}
            >
              {([0, 1, 2, 3] as TextScale[]).map((v) => (
                <option key={v} value={v}>
                  {TEXT_SCALE_LABEL[v]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="row-actions">
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg('');
            setProg(null);
            try {
              const r = await loadBulkData(plan, setProg);
              bump();
              const stages = Object.entries(r.timings)
                .map(([k, v]) => `${k} ${v}ms`)
                .join(' · ');
              setMsg(
                `已创建 ${fmt(r.persons)} 人物、${fmt(r.events)} 事件、${fmt(r.collections)} 事件集、` +
                  `${fmt(r.files)} 文件、${fmt(r.points)} 定位点、${fmt(r.playlists)} 歌单（${fmt(r.tracks)} 曲目）、` +
                  `${fmt(r.messages)} 条聊天。耗时 ${(r.totalMs / 1000).toFixed(1)}s（${stages}）`,
              );
            } catch (e) {
              setMsg(`载入失败：${e instanceof Error ? e.message : String(e)}`);
            } finally {
              setBusy(false);
              setProg(null);
            }
          }}
        >
          {busy ? '正在造数据…' : `载入压测数据（${fmt(plan.events)} 条事件）`}
        </button>
      </div>

      {prog && (
        <div className="sample-progress">
          <div className="sample-progress-bar">
            <div style={{ width: `${prog.total ? Math.min(100, (prog.done / prog.total) * 100) : 0}%` }} />
          </div>
          <span className="muted small">
            {prog.label} {fmt(prog.done)} / {fmt(prog.total)}
          </span>
        </div>
      )}

      {msg && <p className="muted">{msg}</p>}
    </Section>
  );
}
