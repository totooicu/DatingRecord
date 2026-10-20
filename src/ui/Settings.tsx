import { useMemo, useRef, useState } from 'react';
import { clearAllData, dbSizeBytes, exportToFile, importLibrary } from '../core/io';
import { archiveDef, listDefs, upsertDef } from '../core/repo/persons';
import { globalStats } from '../core/repo/events';
import { getRoot } from '../core/repo/collections';
import { queryOne, getMeta, persist } from '../core/db';
import { loadSampleData } from '../core/seed';
import { ATTRIBUTE_TYPES, SCHEMA_VERSION, type AttributeType } from '../core/types';
import { ConfirmButton, Field, Modal } from './common';
import { useVersion, bump } from '../store';

function fmtMeta(iso: string | null): string {
  if (!iso) return '从未';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h4 className="card-title">{title}</h4>
      </div>
      {desc && <p className="muted">{desc}</p>}
      {children}
    </section>
  );
}

export function Settings() {
  const v = useVersion();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [withAttachments, setWithAttachments] = useState(true);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [defOpen, setDefOpen] = useState(false);
  const [editingDef, setEditingDef] = useState<string | null>(null);

  const stats = useMemo(() => globalStats(), [v]);
  const sizeKb = useMemo(() => Math.round(dbSizeBytes() / 1024), [v]);
  const oplogCount = useMemo(
    () => queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM oplog')?.c ?? 0,
    [v],
  );

  const doImport = async (file: File) => {
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      const r = await importLibrary(text, importMode);
      bump();
      setResult(
        `导入完成（${r.mode === 'merge' ? '合并' : '替换'}）：` +
          `属性 ${r.counts.defs}、人物 ${r.counts.persons}、事件 ${r.counts.events}、` +
          `事件集 ${r.counts.collections}、成员 ${r.counts.members}；跳过 ${r.skipped}（本地更新）` +
          (r.backupName ? `。已自动备份：${r.backupName}` : ''),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="detail">
      <h2 className="page-title">设置与数据</h2>

      <Section
        title="数据备份（导入 / 导出）"
        desc="导出为单文件 .drp.json：纯文本、可 diff、可放进 git 做版本管理。建议定期导出到网盘。"
      >
        <div className="row-actions">
          <label className="checkbox">
            <input type="checkbox" checked={withAttachments} onChange={(e) => setWithAttachments(e.target.checked)} />
            包含附件（图片等，会让文件变大）
          </label>
          <button className="btn btn-primary" onClick={() => exportToFile({ includeAttachments: withAttachments })}>
            导出备份文件
          </button>
        </div>

        <div className="row-actions">
          <select value={importMode} onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}>
            <option value="merge">合并导入（按 hlc 比较，本地更新的不会被覆盖）</option>
            <option value="replace">替换导入（清空后写入，会先自动导出一份备份）</option>
          </select>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            选择文件导入
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.drp.json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
              e.target.value = '';
            }}
          />
        </div>

        {result && <div className="alert alert-ok">{result}</div>}
        {error && <div className="alert alert-err">{error}</div>}
        <p className="muted small">
          上次导入：{fmtMeta(getMeta('last_import_at'))}　·　上次打开：{fmtMeta(getMeta('last_opened_at'))}
        </p>
      </Section>

      <Section
        title="属性字典"
        desc="属性定义决定字段的类型、校验与显示方式。key 与 type 创建后不可修改（避免历史数据无法解释），删除一律为归档。"
      >
        <table className="def-table">
          <thead>
            <tr>
              <th>字段名</th>
              <th>key</th>
              <th>类型</th>
              <th>分组</th>
              <th>标记</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {listDefs(true).map((d) => (
              <tr key={d.key} className={d.archived ? 'row-off' : ''}>
                <td>
                  <button className="link-btn" onClick={() => { setEditingDef(d.key); setDefOpen(true); }}>
                    {d.label}
                  </button>
                </td>
                <td><code>{d.key}</code></td>
                <td>{ATTRIBUTE_TYPES.find((t) => t.value === d.type)?.label ?? d.type}</td>
                <td>{d.group}</td>
                <td>
                  {d.sensitive && <em className="badge">敏感</em>}
                  {d.timeVarying && <em className="badge badge-2">随时间</em>}
                  {d.archived && <em className="badge">已归档</em>}
                </td>
                <td>
                  {!d.archived && (
                    <button
                      className="icon-btn"
                      title="归档（保留历史值）"
                      onClick={() => {
                        archiveDef(d.key);
                        bump();
                      }}
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditingDef(null);
              setDefOpen(true);
            }}
          >
            ＋ 新建属性
          </button>
        </div>
      </Section>

      <Section title="库概览">
        <div className="stat-row">
          <div className="stat-card">
            <span className="stat-num">{stats.personCount}</span>
            <span className="stat-label">人物</span>
          </div>
          <div className="stat-card">
            <span className="stat-num">{stats.eventCount}</span>
            <span className="stat-label">事件</span>
          </div>
          <div className="stat-card">
            <span className="stat-num">{oplogCount}</span>
            <span className="stat-label">操作日志</span>
          </div>
          <div className="stat-card">
            <span className="stat-num">{sizeKb} KB</span>
            <span className="stat-label">数据库</span>
          </div>
        </div>
        <p className="muted small">
          schema 版本 {SCHEMA_VERSION}　·　根集合 {getRoot()?.name ?? '—'}　·　操作日志是同步与撤销的基础，写操作会自动追加。
        </p>
      </Section>

      <Section title="示例数据与重置" desc="示例数据会创建 2 位人物、5 条事件、3 个事件集，方便快速看到效果。">
        <div className="row-actions">
          <button
            className="btn"
            onClick={() => {
              loadSampleData();
              bump();
            }}
          >
            载入示例数据
          </button>
          <ConfirmButton
            text="清空全部数据"
            danger
            confirmText="确认清空？建议先导出备份！"
            onConfirm={async () => {
              clearAllData();
              await persist(); // 必须先落盘再刷新，否则 debounce 未触发会「清不掉」
              location.reload();
            }}
          />
        </div>
      </Section>

      {defOpen && (
        <DefFormModal
          key={editingDef ?? 'new'}
          defKey={editingDef}
          onClose={() => {
            setDefOpen(false);
            bump();
          }}
        />
      )}
    </div>
  );
}

function DefFormModal({ defKey, onClose }: { defKey: string | null; onClose: () => void }) {
  const existing = defKey ? listDefs(true).find((d) => d.key === defKey) ?? null : null;
  const [key, setKey] = useState(existing?.key ?? '');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [type, setType] = useState<AttributeType>(existing?.type ?? 'text');
  const [group, setGroup] = useState(existing?.group ?? '自定义');
  const [options, setOptions] = useState((existing?.options ?? []).join('、'));
  const [unit, setUnit] = useState(existing?.unit ?? '');
  const [max, setMax] = useState(existing?.max ?? 5);
  const [sensitive, setSensitive] = useState(existing?.sensitive ?? false);
  const [timeVarying, setTimeVarying] = useState(existing?.timeVarying ?? false);
  const [err, setErr] = useState<string | null>(null);

  const save = () => {
    if (!existing && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
      setErr('key 只能用英文字母、数字、下划线，且以字母开头（创建后不可修改）');
      return;
    }
    if (!label.trim()) {
      setErr('字段名不能为空');
      return;
    }
    upsertDef({
      key: existing?.key ?? key,
      label: label.trim(),
      type: existing?.type ?? type,
      group: group.trim() || '自定义',
      options: options
        .split('、')
        .map((s) => s.trim())
        .filter(Boolean),
      unit: unit || undefined,
      max: type === 'rating' ? max : undefined,
      sensitive,
      timeVarying,
    });
    onClose();
  };

  return (
    <Modal
      title={existing ? `编辑属性 · ${existing.label}` : '新建属性'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="字段名（可随时改）">
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="key（创建后不可改）">
          <input value={key} disabled={!!existing} onChange={(e) => setKey(e.target.value)} placeholder="如 favorite_food" />
        </Field>
        <Field label="类型（创建后不可改）">
          <select value={type} disabled={!!existing} onChange={(e) => setType(e.target.value as AttributeType)}>
            {ATTRIBUTE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="分组">
          <input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="基本信息 / 喜好 / 关系…" />
        </Field>
        {(type === 'enum' || type === 'enumMulti') && (
          <div className="span-2">
            <Field label="选项（用、分隔）">
              <input value={options} onChange={(e) => setOptions(e.target.value)} />
            </Field>
          </div>
        )}
        {type === 'number' && (
          <Field label="单位">
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="cm / kg" />
          </Field>
        )}
        {type === 'rating' && (
          <Field label="满分">
            <input type="number" value={max} onChange={(e) => setMax(Number(e.target.value))} />
          </Field>
        )}
        <Field label="敏感字段">
          <label className="checkbox">
            <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
            展示需谨慎
          </label>
        </Field>
        <Field label="随时间变化">
          <label className="checkbox">
            <input type="checkbox" checked={timeVarying} onChange={(e) => setTimeVarying(e.target.checked)} />
            记录历史快照
          </label>
        </Field>
      </div>
      {err && <div className="alert alert-err">{err}</div>}
    </Modal>
  );
}
