// 后台服务/任务中心。
//
// 服务（Service）：长期运行，可自启动，手动停止才结束。
// 任务（Task）：一次性执行，进行中→完成待查看→已读。
// head 上显示运行中的服务图标 + 进行中/待查看任务图标。

export interface ServiceItem {
  id: string;
  name: string;
  icon: string;
  running: boolean;
  autostart: boolean;
  onStart?: () => void;
  onStop?: () => void;
  onToggleAuto?: (on: boolean) => void;
}

export interface TaskItem {
  id: string;
  name: string;
  icon: string;
  status: 'running' | 'done';
  onOpen: () => void;
}

type Listener = () => void;

let services: ServiceItem[] = [];
let tasks: TaskItem[] = [];
const listeners = new Set<Listener>();

function emit() { listeners.forEach((l) => l()); }

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getServices(): ServiceItem[] { return services; }
export function getTasks(): TaskItem[] { return tasks; }

/** 注册/更新一个服务（重复 id 覆盖） */
export function upsertService(s: ServiceItem): void {
  const i = services.findIndex((x) => x.id === s.id);
  if (i >= 0) {
    const next = services.slice();
    next[i] = s;
    services = next;
  } else {
    services = [...services, s];
  }
  emit();
}

export function removeService(id: string): void {
  services = services.filter((s) => s.id !== id);
  emit();
}

/** 注册/更新一个任务 */
export function upsertTask(t: TaskItem): void {
  const i = tasks.findIndex((x) => x.id === t.id);
  if (i >= 0) {
    const next = tasks.slice();
    next[i] = t;
    tasks = next;
  } else {
    tasks = [...tasks, t];
  }
  emit();
}

/** 任务完成后调用：状态变 done，图标变色 */
export function markTaskDone(id: string): void {
  const i = tasks.findIndex((x) => x.id === id);
  if (i >= 0 && tasks[i].status !== 'done') {
    const next = tasks.slice();
    next[i] = { ...next[i], status: 'done' };
    tasks = next;
    emit();
  }
}

/** 用户打开任务对应页面后调用：从 head 移除通知图标 */
export function dismissTask(id: string): void {
  tasks = tasks.filter((x) => x.id !== id);
  emit();
}

export function toggleService(id: string): void {
  const s = services.find((x) => x.id === id);
  if (!s) return;
  if (s.running) s.onStop?.(); else s.onStart?.();
  // running 状态由调用方通过 upsertService 更新
  emit();
}
