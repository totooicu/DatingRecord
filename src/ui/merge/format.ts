// 合并预览里的值只需要「看得懂」，不必走 AttributeField 的完整类型渲染
export function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (Array.isArray(v)) return v.join('、');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** 精确到秒：同一分钟里连点两次创建也能分辨是哪条 */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知时间';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 同名时用「创建时间 + 事件数」区分两条记录，否则用户根本看不出点的是哪条 */
export function recordLabel(p: { createdAt: string; stats: { eventCount: number } }): string {
  return `${fmtDate(p.createdAt)} 创建 · ${p.stats.eventCount} 次事件`;
}
