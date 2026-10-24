// 与中继进程之间的 WebSocket 连接（服务端 / 客户端共用）。
//
// 只做四件事：握手、发业务消息、收业务消息、断线通知。
// 角色差异留给 router.ts——这一层不碰数据库。

import type { PeerInfo, PeerRole, RelayMessage, RemotePayload } from './types';

export interface TransportHandlers {
  onMessage(msg: RemotePayload, from: string): void;
  onPeer?(ev: 'join' | 'leave', peer: PeerInfo): void;
  onClose?(reason: string): void;
}

export class RemoteTransport {
  private ws: WebSocket | null = null;
  private closedByUs = false;
  /** 中继分配的连接 id；服务端用它区分消息来源 */
  id = '';
  role: PeerRole;
  clients: PeerInfo[] = [];

  get closed(): boolean {
    return this.ws === null;
  }

  constructor(
    private readonly url: string,
    private readonly token: string,
    role: PeerRole,
    private readonly name: string,
    private readonly handlers: TransportHandlers,
  ) {
    this.role = role;
  }

  /** 建连并等 welcome；超时/被拒都抛一句人能看懂的错 */
  connect(timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      this.ws = ws;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.hardClose();
        reject(new Error('连接超时：请确认中继已启动、端口和 token 正确、两台设备在同一网络'));
      }, timeoutMs);

      ws.onopen = () => {
        ws.send(JSON.stringify({ t: 'hello', role: this.role, token: this.token, name: this.name }));
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let m: RelayMessage;
        try {
          m = JSON.parse(ev.data) as RelayMessage;
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          this.id = m.id ?? '';
          this.clients = m.clients ?? [];
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
          return;
        }
        if (m.t === 'peer' && m.event && m.id) {
          const peer: PeerInfo = { id: m.id, name: m.name ?? m.id, role: m.role ?? 'client' };
          if (m.event === 'join' && !this.clients.some((c) => c.id === peer.id)) this.clients.push(peer);
          if (m.event === 'leave') this.clients = this.clients.filter((c) => c.id !== peer.id);
          this.handlers.onPeer?.(m.event, peer);
          return;
        }
        if (m.t === 'msg' && m.msg) {
          this.handlers.onMessage(m.msg, m.from ?? '');
          return;
        }
        if (m.t === 'error') {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            this.hardClose();
            reject(new Error(m.error || '中继拒绝了连接'));
          } else {
            this.handlers.onMessage({ k: 'error', error: m.error || '中继错误' }, '');
          }
        }
      };

      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('连不上中继：请确认地址、端口与中继进程是否在运行'));
      };

      ws.onclose = () => {
        this.ws = null;
        if (settled && !this.closedByUs) {
          this.handlers.onClose?.('连接已断开');
        }
      };
    });
  }

  /** 服务端：发给某个客户端 */
  sendTo(to: string, msg: RemotePayload | object): void {
    this.rawSend({ t: 'to', to, msg });
  }

  /** 服务端：发给所有客户端 */
  broadcast(msg: RemotePayload | object): void {
    this.rawSend({ t: 'broadcast', msg });
  }

  /** 客户端：发给服务端 */
  send(msg: RemotePayload | object): void {
    this.rawSend({ t: 'to', to: 'host', msg });
  }

  private rawSend(obj: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('尚未连接到中继');
    this.ws.send(JSON.stringify(obj));
  }

  close(): void {
    this.closedByUs = true;
    this.hardClose();
  }

  private hardClose(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
}
