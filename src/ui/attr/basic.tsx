// 单值控件：文本 / 数字 / 日期 / 枚举 / 布尔 / 评分 / 标签 / 联系方式 / 关系
import { useState } from 'react';
import type { AttributeDef } from '../../core/types';
import { TagInput } from '../common';
import { ColorPicker } from '../color/ColorPicker';
import { normalizeHex } from '../color/color';

export function LongText({ value, onChange }: { value: string; onChange: (v: unknown) => void }) {
  return <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />;
}

export function NumberField({ def, value, onChange }: FieldProps) {
  return (
    <span className="inline-field">
      {def.type === 'money' && <em>¥</em>}
      <input
        type="number"
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
      {def.unit && <em>{def.unit}</em>}
    </span>
  );
}

export function DateField({ value, onChange }: { value: string; onChange: (v: unknown) => void }) {
  return <input type="date" value={value.slice(0, 10)} onChange={(e) => onChange(e.target.value || null)} />;
}

export function DateTimeField({ value, onChange }: { value: string; onChange: (v: unknown) => void }) {
  return (
    <input
      type="datetime-local"
      value={value.slice(0, 16)}
      onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
    />
  );
}

export function EnumField({ def, value, onChange }: FieldProps) {
  const str = asStr(value);
  return (
    <select value={str} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">未填写</option>
      {(def.options ?? []).map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function EnumMultiField({ def, value, onChange }: FieldProps) {
  const arr = Array.isArray(value) ? (value as string[]) : [];
  return (
    <div className="chip-group">
      {(def.options ?? []).map((o) => (
        <button
          key={o}
          type="button"
          className={arr.includes(o) ? 'chip chip-on' : 'chip'}
          onClick={() => onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function BoolField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
      <span>{value === true ? '是' : '否'}</span>
    </label>
  );
}

/**
 * 星级打分控件：人物属性「好感度」和事件表单「评分」共用同一套。
 * 点当前那一档等于清空（回到未评分），所以 onChange 可能收到 null。
 */
export function Stars({
  value,
  onChange,
  max = 5,
  label = '评分',
}: {
  value: number;
  onChange: (v: number | null) => void;
  max?: number;
  label?: string;
}) {
  const cur = Number.isFinite(value) ? value : 0;
  return (
    <span className="stars" role="group" aria-label={label}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          className={n <= cur ? 'star star-on' : 'star'}
          aria-label={`${n} 星`}
          aria-pressed={n <= cur}
          title={n === cur ? '取消评分' : `${n} 星`}
          onClick={() => onChange(n === cur ? null : n)}
        >
          ★
        </button>
      ))}
    </span>
  );
}

export function RatingField({ def, value, onChange }: FieldProps) {
  return (
    <Stars
      max={def.max ?? 5}
      label={def.label}
      value={typeof value === 'number' ? value : 0}
      onChange={onChange}
    />
  );
}

export function TagField({ value, onChange, choices }: { value: unknown; onChange: (v: unknown) => void; choices?: () => string[] }) {
  return (
    <TagInput
      choices={choices}
      value={Array.isArray(value) ? (value as string[]) : []}
      onChange={(v) => onChange(v.length ? v : null)}
    />
  );
}

export function TextField({
  value,
  onChange,
  type,
}: {
  value: string;
  onChange: (v: unknown) => void;
  type?: string;
}) {
  return type ? (
    <input type={type} value={value} onChange={(e) => onChange(e.target.value || null)} />
  ) : (
    <input value={value} onChange={(e) => onChange(e.target.value || null)} />
  );
}

export function ColorField({ value, onChange }: { value: string; onChange: (v: unknown) => void }) {
  const [open, setOpen] = useState(false);
  const hex = normalizeHex(value);
  return (
    <div className="color-field">
      <button
        type="button"
        className={open ? 'color-field-btn on' : 'color-field-btn'}
        aria-expanded={open}
        aria-label="选择颜色"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={hex ? 'color-field-dot' : 'color-field-dot color-field-dot-empty'}
          style={hex ? { background: hex } : undefined}
        />
        <span className="color-field-val">{hex ?? '选择颜色'}</span>
      </button>
      {open && (
        <div className="color-field-pop">
          <ColorPicker value={hex ?? '#c9a227'} onChange={(v) => onChange(v)} />
        </div>
      )}
    </div>
  );
}

export function RelationField({
  value,
  onChange,
  people,
}: {
  value: string;
  onChange: (v: unknown) => void;
  people: { id: string; displayName: string }[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">未填写</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.displayName}
        </option>
      ))}
    </select>
  );
}

export interface FieldProps {
  def: AttributeDef;
  value: unknown;
  onChange: (v: unknown) => void;
}

export function asStr(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}
