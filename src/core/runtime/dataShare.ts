// 「跨设备操作」作为后台服务：壳端起端口，网页以服务端身份把库挂上去。
//
// 和背景音乐 / 自动打点同一套服务注册表：服务页能看到「运行中 / 自启动」，
// 刷新或重开软件由 restoreAutostartServices() 统一点名恢复。
//
// 和另外两个服务的差别：真正的服务器在壳里（Android 前台服务），页面只能
// 通过桥 remote.* 去开关；浏览器里则没有这个服务（保留 tools/remote-relay 的
// 纯浏览器方案）。所以「自启动」写两份：store 存档（决定页面开机是否恢复）
// + 壳端 SharedPreferences（决定 BootReceiver 是否拉起前台服务）。

import { useSyncExternalStore } from 'react';
import { getRemoteState, startHost, stopHost, subscribeRemote } from '../remote';
import {
  lanAddressOf,
  loopbackWsUrl,
  setShellRelayAutostart,
  shellRelayStatus,
  startShellRelay,
  stopShellRelay,
  type ShellRelayStatus,
} from '../remote/shellRelay';
import { isServiceAutostart, registerService, setServiceAutostart, setServiceRunning } from './store';

export const SERVICE_ID = 'data-share';

export interface DataShareState {
  /** null = 还在探测；false = 浏览器环境，没有壳端服务 */
  supported: boolean | null;
  relayRunning: boolean;
  autostart: boolean;
  /** 手机局域网地址，给界面展示「http://IP:端口」 */
  address: string | null;
  port: number;
  clients: number;
}

let state: DataShareState = {
  supported: null,
  relayRunning: false,
  autostart: false,
  address: null,
  port: 4173,
  clients: 0,
};

const listeners = new Set<() => void>();
function emit(): void {
  listeners.forEach((fn) => fn());
}
function patch(next: Partial<DataShareState>): void {
  state = { ...state, ...next };
  emit();
}

export function useDataShare(): DataShareState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => state,
    () => state,
  );
}

let last: ShellRelayStatus | null = null;

function noteOf(): string {
  const remote = getRemoteState();
  if (!last) return state.supported === false ? '需要壳端服务（浏览器里没有）' : '正在检测…';
  if (!last.running) return '壳端服务未开启';
  if (remote.mode === 'host') return `端口 ${last.port} · ${remote.clients.length} 个客户端`;
  return `端口 ${last.port} 已监听，等待壳端页面开启`;
}

function refresh(): void {
  const remote = getRemoteState();
  const running = remote.mode === 'host';
  const note = noteOf();
  setServiceRunning(SERVICE_ID, running, note);
  patch({
    supported: state.supported,
    relayRunning: !!last?.running,
    autostart: last?.autostart ?? state.autostart,
    address: lanAddressOf(last),
    port: last?.port ?? state.port,
    clients: remote.clients.length,
  });
}

/** 服务页「自启动」开关的写入口：store 存档 + 壳端开机偏好，必要时立刻拉起 */
export async function setDataShareAutostart(on: boolean): Promise<void> {
  setServiceAutostart(SERVICE_ID, on);
  if (state.supported !== false) {
    const st = await setShellRelayAutostart(on);
    if (st) last = st;
  }
  refresh();
  if (on) {
    try {
      await startDataShare();
    } catch (e) {
      setServiceRunning(SERVICE_ID, getRemoteState().mode === 'host', e instanceof Error ? e.message : String(e));
      throw e;
    }
  }
}

/** 开启（或确认）壳端服务，然后让当前页面以服务端身份连上去 */
export async function startDataShare(): Promise<void> {
  let st = last ?? (await shellRelayStatus(3000));
  if (!st) {
    patch({ supported: false });
    throw new Error('当前环境没有壳端服务：需要在手机壳里打开，浏览器请用中继');
  }
  patch({ supported: true });
  if (!st.running) st = await startShellRelay(st.port || 4173, st.token);
  last = st;
  if (getRemoteState().mode !== 'host') {
    await startHost({
      url: loopbackWsUrl(st),
      token: st.token,
      label: `${lanAddressOf(st) ?? '127.0.0.1'}:${st.port}`,
    });
  }
  refresh();
}

/** 停止：断掉服务端连接并关掉壳端端口（客户端会被中继告知「服务端已离线」） */
export async function stopDataShare(): Promise<void> {
  stopHost();
  const st = await stopShellRelay();
  if (st) last = st;
  refresh();
}

/** 刷新一次壳端状态（设置页打开、从后台回来时用） */
export async function refreshDataShare(): Promise<void> {
  const st = await shellRelayStatus(2500);
  if (st) {
    last = st;
    patch({ supported: true });
  } else if (state.supported === null) {
    patch({ supported: false });
  }
  refresh();
}

/**
 * App 启动时调用：先注册服务（交出启动函数），再读壳端状态。
 *
 * 顺序很重要——restoreAutostartServices() 只认已注册的服务；注册放在
 * await 之前，才能保证「开自启动 → 刷新页面」这一步不丢。
 */
export function initDataShareService(): void {
  registerService(
    {
      id: SERVICE_ID,
      kind: 'remote',
      title: '跨设备操作',
      running: getRemoteState().mode === 'host',
      autostart: false,
      target: { type: 'settings', key: 'remote' },
    },
    () => {
      void startDataShare().catch((e) => {
        setServiceRunning(SERVICE_ID, false, e instanceof Error ? e.message : String(e));
      });
    },
  );

  subscribeRemote(refresh);

  void (async () => {
    const st = await shellRelayStatus(2000);
    if (!st) {
      patch({ supported: false });
      refresh();
      return;
    }
    last = st;
    patch({ supported: true });
    // 页面存档说开、壳端存档没开（例如刚重装）：把偏好补下去
    if (isServiceAutostart(SERVICE_ID) && !st.autostart) {
      const next = await setShellRelayAutostart(true);
      if (next) last = next;
    }
    refresh();
    if (isServiceAutostart(SERVICE_ID) && getRemoteState().mode !== 'host') {
      try {
        await startDataShare();
      } catch (e) {
        setServiceRunning(SERVICE_ID, false, e instanceof Error ? e.message : String(e));
      }
    }
  })();
}
