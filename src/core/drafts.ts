// 「未完成的记录」：还没提交的表单草稿。
//
// 放 localStorage 而不是 meta 表：它是这台设备上「刚写了一半」的临时状态，
// 刷新要能捡回来，但不需要跟备份同步，也不该混进库里。数据仍留在本机，
// 清空或关掉开关就把整串 key 删掉。
//
// 写入策略是「宁可不存」：存不下、超体积、JSON 里有循环引用都直接跳过——
// 草稿只是兜底，不能因为它把主流程打断。
const ON_KEY = 'dr.draft.enabled';
const PREFIX = 'dr.draft.';
/** 单份上限：只该存文字和 id，超过这个量级说明存错了东西 */
const MAX_BYTES = 256 * 1024;

export interface SavedDraft<T> {
  /** 展示名：设置页里列草稿时用 */
  label: string;
  updatedAt: number;
  data: T;
}

export interface DraftEntry {
  key: string;
  label: string;
  updatedAt: number;
}

export function draftsEnabled(): boolean {
  return localStorage.getItem(ON_KEY) === '1';
}

export function setDraftsEnabled(on: boolean): void {
  localStorage.setItem(ON_KEY, on ? '1' : '0');
  // 关掉就把旧草稿一起清掉：下次打开不该突然冒出一段历史内容
  if (!on) clearAllDrafts();
}

export function saveDraft<T>(key: string, label: string, data: T): void {
  if (!draftsEnabled()) return;
  try {
    const text = JSON.stringify({ label, updatedAt: Date.now(), data } satisfies SavedDraft<T>);
    if (text.length > MAX_BYTES) return;
    localStorage.setItem(PREFIX + key, text);
  } catch {
    // 配额满了 / 序列化失败：放弃这一份，不影响正在填的表单
  }
}

export function loadDraft<T>(key: string): SavedDraft<T> | null {
  if (!draftsEnabled()) return null;
  const raw = localStorage.getItem(PREFIX + key);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as SavedDraft<T>;
    if (!v || typeof v.updatedAt !== 'number') return null;
    return v;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  localStorage.removeItem(PREFIX + key);
}

export function listDrafts(): DraftEntry[] {
  const out: DraftEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    try {
      const v = JSON.parse(localStorage.getItem(k) ?? '') as SavedDraft<unknown>;
      if (!v || typeof v.updatedAt !== 'number') continue;
      out.push({ key: k.slice(PREFIX.length), label: v.label || k.slice(PREFIX.length), updatedAt: v.updatedAt });
    } catch {
      out.push({ key: k.slice(PREFIX.length), label: k.slice(PREFIX.length), updatedAt: 0 });
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function clearAllDrafts(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
}
