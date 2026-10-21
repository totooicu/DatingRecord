// 应用锁（F-X02）。
//
// 诚实定位：这是「防顺手翻看」的前端闸门，不是加密。
// 口令 hash（加盐 SHA-256）存 localStorage，库数据本身仍是明文——
// 真正的落盘加密是 F-X03，两者不是一回事，UI 上也这么说。
//
// 锁定态是纯会话状态：有口令 = 启动即锁；解锁后本页面内一直有效，
// 空闲超时或手动锁定后重新盖上。

import { sha256Hex } from './sha256';

const KEY_RECORD = 'dr.lock.record'; // `v1$salt$hash`
const KEY_IDLE = 'dr.lock.idleMs';

export const MIN_PASSPHRASE = 4;
/** 输错这么多次后允许放弃口令（数据没加密，本来就该有这条退路） */
export const GIVEUP_AFTER = 10;
const DEFAULT_IDLE = 5 * 60_000;
const CHECK_MS = 5000;

export const IDLE_OPTIONS: { ms: number; label: string }[] = [
  { ms: 60_000, label: '1 分钟' },
  { ms: DEFAULT_IDLE, label: '5 分钟' },
  { ms: 15 * 60_000, label: '15 分钟' },
  { ms: 30 * 60_000, label: '30 分钟' },
  { ms: 0, label: '从不自动锁' },
];

function readRecord(): string | null {
  try {
    return localStorage.getItem(KEY_RECORD);
  } catch {
    return null; // 无痕模式等禁用了存储：当作没设口令
  }
}

export function hasPassphrase(): boolean {
  return !!readRecord();
}

export function getIdleMs(): number {
  const raw = Number(localStorage.getItem(KEY_IDLE) ?? '');
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_IDLE;
}

export function setIdleMs(ms: number): void {
  try {
    localStorage.setItem(KEY_IDLE, String(ms));
  } catch {
    /* 存不进去也不致命，本次会话仍按新值生效 */
  }
  touch();
}

function randomSalt(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 设置/修改口令。调用方负责校验长度与两次输入一致。 */
export function setPassphrase(pw: string): void {
  const salt = randomSalt();
  try {
    localStorage.setItem(KEY_RECORD, `v1$${salt}$${sha256Hex(salt + pw)}`);
  } catch {
    /* 同上 */
  }
  unlock();
}

/** 校验口令。没设口令时恒为 true（没什么可校验的）。 */
export function verifyPassphrase(pw: string): boolean {
  const rec = readRecord();
  if (!rec) return true;
  const parts = rec.split('$');
  if (parts.length !== 3) return false;
  return sha256Hex(parts[1] + pw) === parts[2];
}

export function clearPassphrase(): void {
  try {
    localStorage.removeItem(KEY_RECORD);
  } catch {
    /* 同上 */
  }
  unlock();
}

// ---------------- 会话态 ----------------

let locked = hasPassphrase();
let lastActive = Date.now();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function subscribeLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isLocked(): boolean {
  return locked;
}

export function lock(): void {
  if (!locked) {
    locked = true;
    emit();
  }
}

export function unlock(): void {
  lastActive = Date.now();
  if (locked) {
    locked = false;
    emit();
  }
}

/** 有交互：刷新空闲计时 */
export function touch(): void {
  lastActive = Date.now();
}

export function idleExpired(): boolean {
  const ms = getIdleMs();
  return ms > 0 && Date.now() - lastActive >= ms;
}

/** 空闲轮询间隔。锁定态下不跑，省电。 */
export function idleCheckMs(): number {
  return CHECK_MS;
}
