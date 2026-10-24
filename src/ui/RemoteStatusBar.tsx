// 全局数据源状态条。
//
// 路由器换了库，界面必须让用户一眼知道「现在看的是谁的数据」——
// 否则在客户端上删了一条，以为是自己的库，断开后一头雾水。

import { useState, useSyncExternalStore } from 'react';
import {
  getRemoteState,
  leaveRemoteAndReload,
  stopHost,
  subscribeRemote,
} from '../core/remote';

function useRemote() {
  return useSyncExternalStore(subscribeRemote, getRemoteState, getRemoteState);
}

export function RemoteStatusBar() {
  const r = useRemote();
  const [dismissed, setDismissed] = useState('');

  if (r.mode === 'local' && r.status !== 'error') return null;
  if (r.status === 'error' && dismissed === r.error) return null;

  if (r.mode === 'client') {
    return (
      <div className="remote-bar remote-bar-client" role="status">
        <span>
          <strong>服务端数据</strong> · {r.label}
        </span>
        <button className="btn btn-sm" onClick={() => leaveRemoteAndReload('已断开，回到本地数据')}>
          断开
        </button>
      </div>
    );
  }

  if (r.mode === 'host') {
    return (
      <div className="remote-bar remote-bar-host" role="status">
        <span>
          <strong>跨设备服务已开启</strong> · {r.clients.length} 个客户端在线
        </span>
        <button className="btn btn-sm" onClick={() => stopHost()}>
          停止
        </button>
      </div>
    );
  }

  // 本地 + 错误：说清楚现在的数据源，避免误以为还在远程
  return (
    <div className="remote-bar remote-bar-error" role="alert">
      <span>{r.error || '跨设备连接异常'}</span>
      <button className="btn btn-sm" onClick={() => setDismissed(r.error)}>
        知道了
      </button>
    </div>
  );
}
