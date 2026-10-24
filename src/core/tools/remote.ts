// 跨设备操作的工具入口（只读）。
//
// 连接/断开是浏览器里的交互（要换当前数据库、要 reload），不适合让 AI 中途触发；
// 但 AI 至少要知道「现在看的是谁的库」，否则它会对着客户端界面解释成本地数据。
// CLI 里也借此告诉用户中继该怎么起。

import type { ToolDef } from './types';
import { getRemoteState, savedClientConfig, savedHostConfig } from '../remote';

export const REMOTE_TOOLS: ToolDef[] = [
  {
    name: 'remote.status',
    group: 'remote',
    title: '跨设备操作状态',
    desc:
      '查看当前数据路由器指向哪里：local=本机数据；host=本机作为服务端；client=正在读写另一台设备的数据。' +
      '同时返回传输方式（relay 中继 / direct WebRTC 直连）、客户端数量、版本号/连接地址，以及中继启动命令。',
    mutating: false,
    params: [],
    run: () => {
      const s = getRemoteState();
      const client = savedClientConfig();
      const host = savedHostConfig();
      const port = host ? new URL(host.url).port : '4173';
      return {
        mode: s.mode,
        status: s.status,
        transport: s.transport,
        address: s.label || null,
        clients: s.clients.map((c) => ({ id: c.id, name: c.name })),
        version: s.version,
        error: s.error || null,
        session: {
          client: client ? { label: client.label } : null,
          host: host ? { label: host.label } : null,
        },
        relayCommand: `node tools/remote-relay/server.mjs --port ${port} --token <token>`,
        note:
          s.mode === 'client'
            ? '当前所有读写都发往服务端，不写入本机；断开后回到本机数据。'
            : '当前使用本机数据库。跨设备连接请在「设置 → 备份与分享 → 跨设备操作」里操作（可选择中继或 WebRTC 直连）。',
      };
    },
  },
];
