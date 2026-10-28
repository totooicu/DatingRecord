import { getDef, listPersons } from './persons';
import { listEvents } from './events';

/** 从现有公开记录取候选，不保存额外历史，也不读取私密人物的属性。 */
export function existingInputChoices(source: 'tags' | 'mood' | 'attribute', key?: string): string[] {
  if (source === 'attribute' && (!key || getDef(key)?.sensitive)) return [];
  const counts = new Map<string, number>();
  const add = (value: unknown) => {
    const values = Array.isArray(value) ? value : [value];
    for (const item of new Set(values)) {
      if (typeof item !== 'string' || !item.trim()) continue;
      const text = item.trim();
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  };
  if (source !== 'mood') {
    for (const person of listPersons()) {
      if (person.isPrivate) continue;
      if (source === 'tags') add(person.tags);
      else if (key) add(person.attrs[key]?.v);
    }
  }
  if (source !== 'attribute') {
    for (const event of listEvents()) {
      if (!event.isPrivate) add(source === 'tags' ? event.tags : event.metrics.mood);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([text]) => text);
}
