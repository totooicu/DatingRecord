// 撤销 / 重做：整库快照式。
//
// 为什么不逐行记 before/after：写入口有 44 处（repo 各 write、values、merge、
// members…），逐个补 before 值既啰嗦又容易漏；而这个库为了持久化本来就会整库
// export()（见 persist.ts），一次快照就是一次 memcpy——100KB 的库是微秒级。
// 于是「撤销 = 换回旧实例」，自动覆盖所有写路径，包括合并、迁移、导入。
//
// 代价是内存：每一步一份全量拷贝，用「步数 + 总字节」双上限兜住。附件二进制在
// IndexedDB 自己的 store 里、不进快照，而附件行从不物理删除，所以换回旧实例
// 不会让引用悬空。快照只在内存里，刷新页面即失效——和 Gmail 的「撤销」一个性质。
//
// 状态发布（订阅 / 缓存）在 undoStore.ts，这里只管栈。

import { getDbInstance, getSql, setDbInstance } from './state';
import { flushPersist } from './persist';
import { describeOp } from './undoLabel';
import { notifyUndo, type UndoOp } from './undoStore';
import type { UndoOpRow } from './oplog';

const MAX_STEPS = 40;
const MAX_BYTES = 24 * 1024 * 1024;
/** 一个动作里的多次写（表单逐字段、连点星星）合成一步 */
const COALESCE_MS = 1500;

interface Step {
  label: string;
  at: number;
  bytes: Uint8Array;
}

let undoStack: Step[] = [];
let redoStack: Step[] = [];
let suspended = 0;
/** 上一次写入的时间——合并窗口以它为准（不是上一次拍快照的时间） */
let lastWriteAt = 0;
/** 当前是否有一个「敞着」的步骤可以继续并写 */
let stepOpen = false;
function emit(op: UndoOp): void {
  const top = undoStack.length ? undoStack[undoStack.length - 1] : null;
  notifyUndo({
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    top: top ? { label: top.label, at: top.at } : null,
    op,
  });
}

function totalBytes(): number {
  return undoStack.reduce((s, x) => s + x.bytes.length, 0) + redoStack.reduce((s, x) => s + x.bytes.length, 0);
}

function trim(): void {
  while (undoStack.length > MAX_STEPS) undoStack.shift();
  while (redoStack.length > MAX_STEPS) redoStack.shift();
  while (totalBytes() > MAX_BYTES && undoStack.length + redoStack.length > 2) {
    if (undoStack.length > 1) undoStack.shift();
    else redoStack.shift();
  }
}

function currentBytes(): Uint8Array | null {
  const d = getDbInstance();
  return d ? new Uint8Array(d.export()) : null;
}

function pushUndo(label: string): void {
  const bytes = currentBytes();
  if (!bytes) return;
  undoStack.push({ label, at: Date.now(), bytes });
  redoStack = [];
  trim();
  emit('write');
}

function restore(step: Step): void {
  const sql = getSql();
  if (!sql) return;
  const next = new sql.Database(step.bytes);
  next.run('PRAGMA foreign_keys = ON');
  const old = getDbInstance();
  setDbInstance(next);
  old?.close();
  flushPersist();
}

// ---------------- 事务钩子 ----------------

/** 换掉整个库实例后清空撤销栈：旧快照指向另一份数据，留着会互相污染 */
export function resetUndo(): void {
  undoStack = [];
  redoStack = [];
  stepOpen = false;
  emit('write');
}

/** 批量/特殊操作期间暂停记账（导入、示例数据、迁移） */
export function suspendUndo(): void {
  suspended++;
}

export function resumeUndo(): void {
  if (suspended > 0) suspended--;
}

/**
 * 事务开始前调用。
 *
 * 一个「动作」只记一步：连续两次写间隔小于 COALESCE_MS 就并入同一步——
 * 否则表单里改三个字段要点三次撤销。注意窗口是按「上次写入」算的，
 * 按「上次快照」算会出现「间隔 250ms 的两次写被劈成两步」的怪事。
 *
 * 撤销 / 重做 / 批量操作之后 stepOpen 置 false，紧随的那次写一定开新步，
 * 不会并进一个已经弹出去的步骤里。
 */
export function beginStep(): boolean {
  if (suspended > 0) return false;
  const now = Date.now();
  if (stepOpen && now - lastWriteAt < COALESCE_MS) {
    lastWriteAt = now;
    return false;
  }
  pushUndo('');
  lastWriteAt = now;
  stepOpen = true;
  return true;
}

/** 显式包一个批量动作：只记首尾两步，中间不记 */
export function bulkAction<T>(label: string, fn: () => T): T {
  pushUndo(label);
  stepOpen = false;
  suspendUndo();
  try {
    return fn();
  } finally {
    resumeUndo();
  }
}

/**
 * 只记账、不包执行：给「马上要开始一大串写」的调用方用，
 * 配合 suspendUndo()/resumeUndo()。比 bulkAction 少一层嵌套，
 * 免得为了包一个函数把上百行重新缩进。
 */
export function noteUndoStep(label: string): void {
  pushUndo(label);
  stepOpen = false;
}

/** 用刚写入的 oplog 行给当前这一步命名（同一动作里后写的会覆盖） */
export function labelTopFromOplog(): void {
  if (suspended > 0 || undoStack.length === 0) return;
  const d = getDbInstance();
  if (!d) return;
  // sql.js 的 values 是「按列序的二维数组」，不是对象数组——按位置取
  const res = d.exec(
    'SELECT entity, entity_id, op, payload FROM oplog ORDER BY seq DESC LIMIT 1',
  );
  const row = res[0]?.values[0];
  if (!row) return;
  const [entity, entityId, op, payload] = row as [string, string, string, string | null];
  undoStack[undoStack.length - 1].label = describeOp({
    entity,
    entityId,
    op: op as UndoOpRow['op'],
    payload,
  });
  emit('write');
}

// ---------------- 用户操作 ----------------

export function undo(): boolean {
  const step = undoStack.pop();
  if (!step) return false;
  const now = currentBytes();
  if (now) redoStack.push({ label: step.label, at: Date.now(), bytes: now });
  restore(step);
  stepOpen = false;
  trim();
  emit('undo');
  return true;
}

export function redo(): boolean {
  const step = redoStack.pop();
  if (!step) return false;
  const now = currentBytes();
  if (now) undoStack.push({ label: step.label, at: Date.now(), bytes: now });
  restore(step);
  stepOpen = false;
  trim();
  emit('redo');
  return true;
}
