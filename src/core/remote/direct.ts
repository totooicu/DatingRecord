// WebRTC 直连：两个浏览器直接传数据，不需要中继进程。
//
// 浏览器之间唯一的点对点通道就是 WebRTC DataChannel。它不需要服务器转发数据，
// 但「建连」需要交换一次 SDP/ICE——没有信令服务器，就把这一步做成人工配对：
//
//   服务端「生成邀请码」 ──(复制/扫码)──▶ 客户端粘贴 → 生成「应答码」
//   服务端粘贴应答码 ────────────────────▶ 通道打开，开始同步整库
//
// 局域网内只靠 host candidate 就能打通，所以默认不配 STUN；
// 跨公网可以填一个 STUN（只用于发现地址，不转发数据）。
//
// 协议和 ws 那条完全一样（snapshot / apply / blob-*），这一层只负责
// 「一条连接」的收发、分片和 hello，路由层不区分底下是 ws 还是 DataChannel。

import type { PeerInfo, RemoteLink, RemotePayload } from './types';
import type { TransportHandlers } from './transport';

const INVITE_PREFIX = 'DR1H:';
const ANSWER_PREFIX = 'DR1A:';
/** DataChannel 单条消息上限各浏览器不同（SCTP 通常 64KB），留足余量 */
const PART_SIZE = 12000;
const MAX_PARTS = 20000;

interface Payload {
  v: 1;
  sdp: string;
  name: string;
  stun: string[];
}

// ---------------- 邀请码编解码 ----------------

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function b64decode(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function encodeCode(prefix: string, payload: Payload): string {
  return `${prefix}${b64encode(JSON.stringify(payload))}`;
}

function decodeCode(code: string, prefix: string, what: string): Payload {
  const raw = code.trim().replace(/\s+/g, '');
  if (!raw) throw new Error(`请粘贴${what}`);
  if (!raw.toUpperCase().startsWith(prefix)) {
    throw new Error(`这不是${what}：应该以 ${prefix} 开头`);
  }
  let data: Payload;
  try {
    data = JSON.parse(b64decode(raw.slice(prefix.length))) as Payload;
  } catch {
    throw new Error(`${what}不完整或已损坏，请整段重新复制`);
  }
  if (data?.v !== 1 || typeof data.sdp !== 'string' || !data.sdp.includes('v=0')) {
    throw new Error(`${what}格式不对，请重新生成`);
  }
  return data;
}

/** 用户可能填 "stun:host:port"、多个用逗号隔开；空 = 纯局域网 */
export function parseStun(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith('stun:') || s.startsWith('stuns:') ? s : `stun:${s}`));
}

// ---------------- 连接本体 ----------------

/**
 * 一条 WebRTC 连接：把 DataChannel 包成 Router 认识的 RemoteLink。
 *
 * 大消息（整库快照可能几 MB）按 12KB 分片，带 begin/part 头重组；
 * 通道本身是 ordered + reliable，所以只按序号拼接即可。
 */
export class DirectChannel implements RemoteLink {
  readonly role: 'host' | 'client';
  id = 'peer';
  closed = false;
  clients: PeerInfo[] = [];

  private handlers: TransportHandlers | null = null;
  /** 通道开得比 handler 早时，先把原始消息排队 */
  private queue: string[] = [];
  private incoming = new Map<string, { total: number; parts: string[]; got: number }>();
  private myName: string;
  private peerName = '对方设备';
  private fragSeq = 0;

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly dc: RTCDataChannel,
    role: 'host' | 'client',
    name: string,
  ) {
    this.role = role;
    this.myName = name;
    dc.onopen = () => {
      try {
        dc.send(JSON.stringify({ f: 'hello', name: this.myName }));
      } catch {
        /* 对端可能已经走了 */
      }
    };
    dc.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      if (this.handlers) this.handleRaw(ev.data);
      else this.queue.push(ev.data);
    };
    // 对端关页面/关连接：DataChannel 会先 close，比 ICE failed 快得多
    dc.onclose = () => this.fail();
    pc.addEventListener('connectionstatechange', () => {
      const st = pc.connectionState;
      if (st === 'failed' || st === 'closed') this.fail();
      else if (st === 'disconnected') {
        // 短暂抖动先不判死，等 ICE 自己恢复；彻底断了由 failed 兜底
      }
    });
  }

  /** 路由层拿到连接后再挂 handler：之前收到的消息会在这里补发 */
  attach(handlers: TransportHandlers): void {
    this.handlers = handlers;
    const queued = this.queue;
    this.queue = [];
    queued.forEach((raw) => this.handleRaw(raw));
  }

  send(msg: RemotePayload | object): void {
    this.write(JSON.stringify(msg));
  }

  sendTo(_to: string, msg: RemotePayload | object): void {
    this.send(msg);
  }

  broadcast(msg: RemotePayload | object): void {
    this.send(msg);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.dc.close();
    } catch {
      /* ignore */
    }
    try {
      this.pc.close();
    } catch {
      /* ignore */
    }
  }

  private fail(): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers?.onPeer?.('leave', { id: 'peer', name: this.peerName, role: 'client' });
    this.clients = [];
    try {
      this.pc.close();
    } catch {
      /* ignore */
    }
    this.handlers?.onClose?.('直连已断开');
    this.closed = true;
  }

  // ---------------- 收发 ----------------

  private write(text: string): void {
    if (this.dc.readyState !== 'open') throw new Error('直连尚未建立');
    if (text.length <= PART_SIZE) {
      this.dc.send(text);
      return;
    }
    const id = `f${(this.fragSeq += 1)}`;
    const total = Math.ceil(text.length / PART_SIZE);
    this.dc.send(JSON.stringify({ f: 'b', id, n: total }));
    for (let i = 0; i < total; i += 1) {
      this.dc.send(JSON.stringify({ f: 'p', id, d: text.slice(i * PART_SIZE, (i + 1) * PART_SIZE) }));
    }
  }

  private handleRaw(raw: string): void {
    let frame: { f?: string; id?: string; n?: number; d?: string; name?: string; k?: string };
    try {
      frame = JSON.parse(raw) as typeof frame;
    } catch {
      return;
    }
    if (!frame || typeof frame !== 'object') return;

    if (frame.f && !frame.k) {
      if (frame.f === 'hello') {
        this.peerName = String(frame.name ?? '对方设备');
        this.clients = [{ id: 'peer', name: this.peerName, role: this.role === 'host' ? 'client' : 'host' }];
        this.handlers?.onPeer?.('join', this.clients[0]);
        return;
      }
      if (frame.f === 'b' && frame.id && frame.n) {
        const n = Number(frame.n);
        if (!Number.isInteger(n) || n <= 0 || n > MAX_PARTS) return;
        this.incoming.set(frame.id, { total: n, parts: new Array(n).fill(''), got: 0 });
        return;
      }
      if (frame.f === 'p' && frame.id && typeof frame.d === 'string') {
        const buf = this.incoming.get(frame.id);
        if (!buf) return;
        buf.parts[buf.got] = frame.d;
        buf.got += 1;
        if (buf.got >= buf.total) {
          this.incoming.delete(frame.id);
          this.handleRaw(buf.parts.join(''));
        }
        return;
      }
      return;
    }

    this.handlers?.onMessage(frame as unknown as RemotePayload, 'peer');
  }
}

// ---------------- 建连（人工信令） ----------------

async function gatherSdp(pc: RTCPeerConnection, timeoutMs = 4000): Promise<string> {
  if (pc.iceGatheringState === 'complete' && pc.localDescription) return pc.localDescription.sdp;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
  if (!pc.localDescription) throw new Error('没能生成本地连接信息');
  return pc.localDescription.sdp;
}

function newPeer(stun: string[]): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: stun.length ? [{ urls: stun }] : [] });
}

export interface DirectHostSession {
  /** 邀请码（含 SDP 与 STUN 配置），等它 resolve 再展示 */
  invite: Promise<string>;
  /** 粘贴对方应答码 */
  complete(answerCode: string): Promise<void>;
  /** 通道打开（对端已粘贴邀请码并生成应答） */
  open: Promise<DirectChannel>;
  close(): void;
}

/**
 * 服务端侧：先建 DataChannel 再出 offer，邀请码里带上 STUN，
 * 保证两端用同一套候选发现方式。
 */
export function createDirectHost(opts: { stun?: string; name: string }): DirectHostSession {
  const stun = parseStun(opts.stun ?? '');
  const pc = newPeer(stun);
  const dc = pc.createDataChannel('dr', { ordered: true });
  const link = new DirectChannel(pc, dc, 'host', opts.name);
  let settled = false;
  let rejectOpen: ((e: Error) => void) | null = null;

  const invite = (async () => {
    await pc.setLocalDescription(await pc.createOffer());
    const sdp = await gatherSdp(pc);
    return encodeCode(INVITE_PREFIX, { v: 1, sdp, name: opts.name, stun });
  })();

  const open = new Promise<DirectChannel>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待对方连接超时，请重新生成邀请码')), 120000);
    rejectOpen = reject;
    dc.onopen = () => {
      clearTimeout(timer);
      settled = true;
      rejectOpen = null;
      try {
        dc.send(JSON.stringify({ f: 'hello', name: opts.name }));
      } catch {
        /* ignore */
      }
      resolve(link);
    };
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' && !settled) {
        clearTimeout(timer);
        reject(new Error('直连建立失败：网络可能不允许 P2P，可尝试填写 STUN 或改用中继'));
      }
    });
  });
  open.catch(() => link.close());

  return {
    invite,
    async complete(answerCode: string) {
      const data = decodeCode(answerCode, ANSWER_PREFIX, '应答码');
      await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
    },
    open,
    close() {
      rejectOpen?.(new Error('已取消配对'));
      link.close();
    },
  };
}

export interface DirectClientSession {
  /** 应答码：交给服务端粘贴 */
  answer: Promise<string>;
  open: Promise<DirectChannel>;
  close(): void;
}

/** 客户端侧：吃邀请码、出应答码，等服务端贴回来通道就开 */
export function createDirectClient(inviteCode: string, name: string): DirectClientSession {
  const data = decodeCode(inviteCode, INVITE_PREFIX, '邀请码');
  const pc = newPeer(data.stun ?? []);
  let link: DirectChannel | null = null;
  let settled = false;
  let rejectOpen: ((e: Error) => void) | null = null;

  const answer = (async () => {
    await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    const sdp = await gatherSdp(pc);
    return encodeCode(ANSWER_PREFIX, { v: 1, sdp, name, stun: data.stun ?? [] });
  })();

  const open = new Promise<DirectChannel>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待服务端粘贴应答码超时，请重新配对')), 120000);
    rejectOpen = reject;
    pc.ondatachannel = (ev) => {
      link = new DirectChannel(pc, ev.channel, 'client', name);
      // 客户端也要先发 hello，服务端才能知道对端是哪个设备
      ev.channel.onopen = () => {
        clearTimeout(timer);
        settled = true;
        rejectOpen = null;
        try {
          ev.channel.send(JSON.stringify({ f: 'hello', name }));
        } catch {
          /* ignore */
        }
        resolve(link as DirectChannel);
      };
    };
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' && !settled) {
        clearTimeout(timer);
        reject(new Error('直连建立失败：网络可能不允许 P2P，可让服务端填 STUN 或改用中继'));
      }
    });
  });
  open.catch(() => {
    link?.close();
    try {
      pc.close();
    } catch {
      /* ignore */
    }
  });

  return {
    answer,
    open,
    close() {
      rejectOpen?.(new Error('已取消配对'));
      link?.close();
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    },
  };
}
