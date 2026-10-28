import { toLocalInput } from '../../core/time';

export function timeText(iso: string | null): string {
  return toLocalInput(iso).replace('T', ' ');
}

export function parseTimeText(text: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return null;
  const date = new Date(text.replace(' ', 'T'));
  if (!Number.isFinite(date.getTime())) return null;
  const iso = date.toISOString();
  return timeText(iso) === text ? iso : null;
}
