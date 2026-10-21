// 展示态：把属性值渲染成一行文字
import type { AttributeDef } from '../../core/types';

export function formatAttrValue(
  def: AttributeDef,
  value: unknown,
  personName?: (id: string) => string,
): string {
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
