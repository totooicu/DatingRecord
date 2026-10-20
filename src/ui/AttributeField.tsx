import type { AttributeDef, Person } from '../core/types';
import { listPersons } from '../core/repo/persons';
import { TagInput } from './common';

/** 按属性类型渲染对应控件 */
export function AttributeField({
  def,
  value,
  onChange,
  persons,
}: {
  def: AttributeDef;
  value: unknown;
  onChange: (v: unknown) => void;
  persons?: Pick<Person, 'id' | 'displayName'>[];
}) {
  const people = persons ?? listPersons({ includeArchived: true }).map((p) => ({ id: p.id, displayName: p.displayName }));
  const str = typeof value === 'string' ? value : value == null ? '' : String(value);

  switch (def.type) {
    case 'longtext':
      return <textarea rows={3} value={str} onChange={(e) => onChange(e.target.value)} />;

    case 'number':
    case 'money':
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

    case 'date':
      return <input type="date" value={str.slice(0, 10)} onChange={(e) => onChange(e.target.value || null)} />;

    case 'datetime':
      return (
        <input
          type="datetime-local"
          value={str.slice(0, 16)}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      );

    case 'enum':
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

    case 'enumMulti': {
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

    case 'boolean':
      return (
        <label className="switch">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span>{value === true ? '是' : '否'}</span>
        </label>
      );

    case 'rating': {
      const max = def.max ?? 5;
      const cur = typeof value === 'number' ? value : 0;
      return (
        <span className="stars">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={n <= cur ? 'star star-on' : 'star'}
              onClick={() => onChange(n === cur ? null : n)}
            >
              ★
            </button>
          ))}
        </span>
      );
    }

    case 'tag':
      return <TagInput value={Array.isArray(value) ? (value as string[]) : []} onChange={(v) => onChange(v.length ? v : null)} />;

    case 'phone':
      return <input type="tel" value={str} onChange={(e) => onChange(e.target.value || null)} />;

    case 'email':
      return <input type="email" value={str} onChange={(e) => onChange(e.target.value || null)} />;

    case 'url':
      return <input type="url" value={str} onChange={(e) => onChange(e.target.value || null)} />;

    case 'color':
      return <input type="color" value={str || '#c9a227'} onChange={(e) => onChange(e.target.value)} />;

    case 'relation':
      return (
        <select value={str} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">未填写</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      );

    case 'geo': {
      const g = (value ?? {}) as { lat?: number; lng?: number };
      return (
        <span className="inline-field">
          <input
            type="number"
            step="0.000001"
            placeholder="纬度"
            value={g.lat ?? ''}
            onChange={(e) => onChange({ ...g, lat: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
          <input
            type="number"
            step="0.000001"
            placeholder="经度"
            value={g.lng ?? ''}
            onChange={(e) => onChange({ ...g, lng: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </span>
      );
    }

    case 'social': {
      const s = (value ?? {}) as { platform?: string; handle?: string };
      return (
        <span className="inline-field">
          <input
            placeholder="平台"
            value={s.platform ?? ''}
            onChange={(e) => onChange({ ...s, platform: e.target.value || undefined })}
          />
          <input
            placeholder="账号"
            value={s.handle ?? ''}
            onChange={(e) => onChange({ ...s, handle: e.target.value || undefined })}
          />
        </span>
      );
    }

    case 'json':
      return (
        <textarea
          rows={3}
          value={typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value));
            } catch {
              onChange(e.target.value);
            }
          }}
        />
      );

    default:
      return <input value={str} onChange={(e) => onChange(e.target.value || null)} />;
  }
}

/** 展示态：把属性值渲染成一行文字 */
export function formatAttrValue(def: AttributeDef, value: unknown, personName?: (id: string) => string): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (def.type) {
    case 'boolean':
      return value ? '是' : '否';
    case 'rating':
      return '★'.repeat(Number(value)) + ` (${value}/${def.max ?? 5})`;
    case 'money':
      return `¥${value}`;
    case 'number':
      return `${value}${def.unit ?? ''}`;
    case 'tag':
    case 'enumMulti':
      return Array.isArray(value) ? value.join('、') : String(value);
    case 'relation':
      return personName ? personName(String(value)) : String(value);
    case 'geo': {
      const g = value as { lat?: number; lng?: number };
      return `${g.lat ?? '?'}, ${g.lng ?? '?'}`;
    }
    case 'social': {
      const s = value as { platform?: string; handle?: string };
      return [s.platform, s.handle].filter(Boolean).join(' · ');
    }
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value);
    default:
      return String(value);
  }
}
