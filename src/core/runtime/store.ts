// 服务 / 任务 两层体系的运行时数据中心。

// 「任务」是一次性后台工作（如 AI 正在回复你）：有进行中 / 成功 / 失败三态，
// 完成后在 head 上变色提示，点一下跳到来源页并把通知消掉。
// 「服务」是常驻后台的东西（如背景音乐）：运行时常驻图标、可自启动、
// 被浏览器策略拦住时显示「待播放」之类的待办状态。

// 这里只存「状态 + 跳转目标」，不碰任何 UI；UI 用 useTasks / useServices 订阅。

export type TaskStatus = 'running' | 'success' | 'error';

/** 跳转目标：点状态图标要去哪。settings 指向设置子页；page 指向服务/任务页 */
export type NavTarget =
  | { type: 'settings'; key: string }
  | { type: 'page'; key: 'services' | 'tasks' };

export interface TaskItem {
  id: string;
  /** 同类任务只保留一条活动记录：例如 ai-chat */
  kind: string;
  title: string;
  status: TaskStatus;
  startedAt: number;
  finishedAt?: number;
  /** 失败原因 / 完成小结，显示在任务页与 tooltip */
  note?: string;
  /** 通知是否已读：finished 且未读时 head 有角标，点开来源页即清 */
  unread: boolean;
  target: NavTarget;
}

export interface ServiceItem {
  id: string;
  kind: string;
  title: string;
  running: boolean;
  /** 开软件自动启动（仅服务有） */
  autostart: boolean;
  /** 待办说明，例如「待播放：点一下恢复」（被浏览器拦时） */
  note?: string;
  /** 当前活动说明，例如正在播放的曲名；显示在 head 图标的悬停提示里 */
  detail?: string;
  target: NavTarget;
}

// ---- 状态存储（pub/sub，仿 toast.tsx 的模式，无需引入状态库） ----

import { useEffect, useState } from 'react';

let tasks: TaskItem[] = [];
let services: ServiceItem[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** 订阅式读取：任何对 tasks/services 的改动都会触发重渲染 */
function useStore<T>(selector: () => T): T {
  const [val, setVal] = useState<T>(selector());
  useEffect(() => {
    const update = () => setVal(selector());
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return val;
}

// ---- 任务 API ----

export function addTask(t: Omit<TaskItem, 'unread' | 'startedAt'> & { startedAt?: number }): TaskItem {
  const full: TaskItem = {
    unread: true,
    startedAt: t.startedAt ?? Date.now(),
    ...t,
  };
  // 同 kind 只留一条活动任务：新来的顶掉旧的，避免 head 上堆图标
  tasks = [...tasks.filter((x) => x.kind !== full.kind || x.status === 'success' || x.status === 'error'), full];
  emit();
  return full;
}

export function updateTask(id: string, patch: Partial<TaskItem>): void {
  tasks = tasks.map((x) => (x.id === id ? { ...x, ...patch } : x));
  emit();
}

export function finishTask(id: string, ok: boolean, note?: string, title?: string): void {
  tasks = tasks.map((x) =>
    // 完成即视为「新的未读通知」：即便此前在聊天页看过（清过未读），
    // 完成时仍要变绿/变红提示用户，直到他点开/点图标才消失。
    x.id === id
      ? {
          ...x,
          title: title ?? x.title,
          status: ok ? 'success' : 'error',
          finishedAt: Date.now(),
          note: note ?? x.note,
          unread: true,
        }
      : x,
  );
  emit();
}

/** 把某类任务的通知标为已读（打开来源页时调用） */
export function markTaskRead(kind: string): void {
  let changed = false;
  tasks = tasks.map((x) => {
    if (x.kind === kind && x.unread) {
      changed = true;
      return { ...x, unread: false };
    }
    return x;
  });
  if (changed) emit();
}

export function removeTask(id: string): void {
  tasks = tasks.filter((x) => x.id !== id);
  emit();
}

export function getTasks(): TaskItem[] {
  return tasks;
}

// ---- 服务 API ----

// 自启动存档：「开软件自动启动」是刷新/重开都要兑现的偏好，属存档不属内存。
// 每个服务的 autostart 存进同一张表（只记 true，缺省即 false），
// registerService 注册时以存档为准，restoreAutostartServices() 在应用
// 加载完毕后统一点名恢复——服务自己不用各写一个 localStorage key。

const AUTOSTART_KEY = 'dr.svc.autostart';
/** 各服务注册时交出来的「启动函数」，供开机恢复时调用 */
const starters = new Map<string, () => void>();

function readAutostartMap(): Record<string, true> {
  try {
    const raw = localStorage.getItem(AUTOSTART_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function writeAutostartMap(m: Record<string, true>): void {
  try {
    if (Object.keys(m).length > 0) localStorage.setItem(AUTOSTART_KEY, JSON.stringify(m));
    else localStorage.removeItem(AUTOSTART_KEY);
  } catch {
    /* 隐私模式写不进就算了 */
  }
}

/** 某个服务是否开了自启动（存档为准；服务还没注册也能问） */
export function isServiceAutostart(id: string): boolean {
  return readAutostartMap()[id] === true;
}

export function registerService(s: ServiceItem, start?: () => void): void {
  if (start) starters.set(s.id, start);
  // 自启动一律以存档为准：调用方传的可能是默认值或旧版 key，
  // 覆盖之后服务页的 checkbox 才和「刷新后实际会不会自启」一致。
  const autostart = isServiceAutostart(s.id);
  const existing = services.find((x) => x.id === s.id);
  if (existing) {
    // 已有则只更新可变字段，保留外部可能改过的 running
    services = services.map((x) =>
      x.id === s.id ? { ...x, title: s.title, note: s.note, target: s.target, autostart } : x,
    );
  } else {
    services = [...services, { ...s, autostart }];
  }
  emit();
}

export function setServiceRunning(id: string, running: boolean, note?: string): void {
  services = services.map((x) => (x.id === id ? { ...x, running, note: note === undefined ? x.note : note } : x));
  emit();
}

export function setServiceNote(id: string, note: string | undefined): void {
  services = services.map((x) => (x.id === id ? { ...x, note } : x));
  emit();
}

export function setServiceDetail(id: string, detail: string | undefined): void {
  services = services.map((x) => (x.id === id ? { ...x, detail } : x));
  emit();
}

export function setServiceAutostart(id: string, autostart: boolean): void {
  const m = readAutostartMap();
  if (autostart) m[id] = true;
  else delete m[id];
  writeAutostartMap(m);
  services = services.map((x) => (x.id === id ? { ...x, autostart } : x));
  emit();
}

/** 应用加载完毕后调用：把存档里开了自启动的服务逐一拉起来。
 *  先决条件是各服务都已 registerService（交出了启动函数）。 */
export function restoreAutostartServices(): void {
  for (const s of services) {
    if (!s.autostart || s.running) continue;
    starters.get(s.id)?.();
  }
}

export function getServices(): ServiceItem[] {
  return services;
}

// ---- 订阅 hooks ----

export function useTasks(): TaskItem[] {
  return useStore(() => tasks);
}

export function useServices(): ServiceItem[] {
  return useStore(() => services);
}
