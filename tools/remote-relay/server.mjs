#!/usr/bin/env node
// 跨设备操作中继。
//
// 为什么需要它：浏览器页面没法监听端口（Direct Sockets 只在实验性的
// Isolated Web App 里可用），所以「服务端页面」和「客户端页面」之间
// 必须有一个能收连接的小进程。这个进程不碰数据库，只做三件事：
//
//   1. 托管构建产物（客户端打开 http://本机IP:端口 就能加载同一个页面）
//   2. 在 /remote 上做 WebSocket 握手，按 token 分房间
//   3. 转发消息：客户端 → 服务端；服务端 → 单个 / 全部客户端
//
// 数据库始终在「服务端」那个浏览器标签页里；中继只转发整库快照和附件字节。
//
// 用法：
//   node tools/remote-relay/server.mjs --port 4173 --token mytoken
//   node tools/remote-relay/server.mjs --port 4173 --token mytoken --dist dist
//
// 说明见同目录 README.md。

import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 64 * 1024 * 1024;
const __dirname = fileURLToPath(new URL('.', import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DIST = resolve(arg('dist', resolve(__dirname, '../../dist')));
const HOST = arg('host', '0.0.0.0');
const PRIMARY_PORT = Number(arg('port', '4173'));
const PRIMARY_TOKEN = arg('token', randomBytes(5).toString('hex'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

/** 一个监听端口 = 一个房间集合；不同端口互不相通 */
class Listener {
  constructor(port, token) {
    this.port = port;
    this.token = token;
    /** token → { host, clients: Map<id, conn> } */
    this.rooms = new Map();
    this.server = null;
    this.seq = 0;
  }

  room(token) {
    let r = this.rooms.get(token);
    if (!r) {
      r = { host: null, clients: new Map() };
      this.rooms.set(token, r);
    }
    return r;
  }

  nextClientId() {
    this.seq += 1;
    return `c${this.seq}`;
  }

  listen() {
    return new Promise((resolvePromise, reject) => {
      const server = http.createServer((req, res) => this.httpHandler(req, res));
      this.server = server;
      server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
      // 连上来之后再把 reject 摘掉：之后任何 socket 级错误都不能让整个进程退出，
      // 否则服务端会被动掉线（一个坏请求就能把所有人的连接一起带走）。
      server.on('error', reject);
      server.listen(this.port, HOST, () => {
        server.off('error', reject);
        server.on('error', (e) => console.error('[remote-relay] 服务器错误：', e.message));
        server.on('clientError', (_e, socket) => {
          try {
            socket.destroy();
          } catch {
            /* ignore */
          }
        });
        resolvePromise(this);
      });
    });
  }

  close() {
    return new Promise((resolvePromise) => {
      if (!this.server) return resolvePromise();
      for (const room of this.rooms.values()) {
        room.host?.close();
        for (const c of room.clients.values()) c.close();
      }
      this.rooms.clear();
      this.server.close(() => resolvePromise());
    });
  }

  httpHandler(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname === '/__remote/info') return this.info(url, res);
    if (url.pathname === '/__remote/listen') return this.controlListen(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('method not allowed');
      return;
    }
    this.serveStatic(url.pathname, req, res);
  }

  /**
   * 中继自述：端口、地址、服务端在不在、token 对不对。
   *
   * 客户端在另一台设备上，连之前先问这一句，就能把「连不上 / token 错 /
   * 服务端没开」分开报，而不是一律「连不上中继」。
   * 带 CORS 是因为这个请求来自客户端页面自身的域名，而不是中继托管的页面。
   */
  info(url, res) {
    const room = this.rooms.get(this.token);
    const asked = url.searchParams.get('token');
    const body = JSON.stringify({
      ok: true,
      port: this.port,
      hostOnline: !!room?.host,
      clients: room ? room.clients.size : 0,
      /** 没问 token 就不回答，避免谁都能白拿一个校验服务 */
      tokenOk: asked === null ? null : asked === this.token,
      addresses: lanAddresses(),
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  }

  controlListen(req, res) {
    const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    // 只允许「本机」页面开新端口：loopback 或本机的局域网地址
    const local = new Set(['127.0.0.1', '::1', ...lanAddresses()]);
    if (!local.has(remote)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: '只允许本机页面开启新端口' }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: '请用 POST' }));
      return;
    }
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 4096) req.destroy();
    });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const port = Number(data.port);
        const token = String(data.token ?? '').trim();
        if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('端口号不合法');
        if (!token) throw new Error('token 不能为空');
        if (port === this.port) {
          // 已经有服务端在线时不换 token：换了会让它瞬间变「不在线」，
          // 客户端还会因 401 报「连不上中继」。
          const busy = [...this.rooms.values()].some((r) => r.host);
          if (busy && token !== this.token) {
            throw new Error('该端口已有服务端在用，请保持 token 不变（或先停止原来的服务端）');
          }
          this.token = token;
        } else if (!(await openPort(port, token))) {
          // openPort 返回 false 表示端口已被占用；同端口同 token 视为成功
          throw new Error(`端口 ${port} 已被占用，或该端口已有服务端在用（token 需与它一致）`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, port }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
    });
  }

  serveStatic(pathname, req, res) {
    const rel = decodeURIComponent(pathname);
    const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
    let file = join(DIST, safe);
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // 前端路由：找不到文件就回 index.html
      file = join(DIST, 'index.html');
      if (!existsSync(file)) {
        res.writeHead(404).end('dist/index.html 不存在：先运行 npm run build，或用 --dist 指定目录');
        return;
      }
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const size = statSync(file).size;
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': size,
      // 版本更新靠 SW；这里不缓存入口，避免手机上一直拿到旧壳
      'Cache-Control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  }

  handleUpgrade(req, socket, head) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/remote' && url.pathname !== '/') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const token = url.searchParams.get('token') ?? '';
    if (token !== this.token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    new Conn(this, socket, token).attach(head);
  }
}

// ---------------- WebSocket 连接 ----------------

class Conn {
  constructor(listener, socket, token) {
    this.listener = listener;
    this.socket = socket;
    this.token = token;
    this.id = '';
    this.role = '';
    this.name = '';
    this.buffer = Buffer.alloc(0);
    this.parts = [];
    this.closed = false;
  }

  attach(head) {
    if (head?.length) this.buffer = Buffer.concat([this.buffer, head]);
    this.socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.parse();
    });
    this.socket.on('close', () => this.leave());
    this.socket.on('error', () => this.leave());
    this.parse();
  }

  parse() {
    for (;;) {
      if (this.buffer.length < 2) return;
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME)) return this.close(1009);
        len = Number(big);
        off = 10;
      }
      if (len > MAX_FRAME) return this.close(1009);
      let mask = null;
      if (masked) {
        if (this.buffer.length < off + 4) return;
        mask = this.buffer.subarray(off, off + 4);
        off += 4;
      }
      if (this.buffer.length < off + len) return;
      const payload = Buffer.from(this.buffer.subarray(off, off + len));
      this.buffer = this.buffer.subarray(off + len);
      if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];

      if (opcode === 0x8) return this.close(1000);
      if (opcode === 0x9) {
        this.sendFrame(0xa, payload);
        continue;
      }
      if (opcode === 0xa) continue;

      if (opcode === 0x0) {
        this.parts.push(payload);
      } else if (opcode === 0x1 || opcode === 0x2) {
        this.parts = [payload];
      } else {
        continue;
      }
      if (!fin) continue;
      const whole = Buffer.concat(this.parts);
      this.parts = [];
      if (opcode === 0x1 || opcode === 0x0) this.onText(whole.toString('utf8'));
    }
  }

  onText(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return this.reply({ t: 'error', error: '消息不是合法 JSON' });
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'hello') {
      const role = msg.role === 'host' ? 'host' : 'client';
      const room = this.listener.room(this.token);
      this.role = role;
      this.name = String(msg.name ?? role);
      if (role === 'host') {
        if (room.host) return this.reject('已有服务端在线，请先关闭原来的服务端页面');
        this.id = 'host';
        room.host = this;
      } else {
        this.id = this.listener.nextClientId();
        room.clients.set(this.id, this);
      }
      this.reply({
        t: 'welcome',
        id: this.id,
        role,
        hostOnline: !!room.host,
        clients: role === 'host' ? [...room.clients.values()].map(peerInfo) : [],
      });
      // 让服务端知道谁进来了，消息来源靠这个 id 区分
      if (role === 'client') room.host?.reply({ t: 'peer', event: 'join', ...peerInfo(this) });
      return;
    }

    if (!this.id) return this.reject('请先发送 hello');

    const room = this.listener.room(this.token);
    if (this.role === 'host') {
      if (msg.t === 'to' && msg.to) {
        const c = room.clients.get(msg.to);
        if (c) c.reply({ t: 'msg', from: this.id, msg: msg.msg });
        return;
      }
      if (msg.t === 'broadcast') {
        for (const c of room.clients.values()) c.reply({ t: 'msg', from: this.id, msg: msg.msg });
        return;
      }
      return;
    }

    // 客户端：永远发给服务端，附上来源 id
    if (!room.host) return this.reply({ t: 'error', error: '服务端不在线' });
    if (msg.t === 'to' || msg.t === 'broadcast') {
      room.host.reply({ t: 'msg', from: this.id, msg: msg.msg });
    }
  }

  reply(obj) {
    this.sendFrame(0x1, Buffer.from(JSON.stringify(obj)));
  }

  reject(text) {
    this.reply({ t: 'error', error: text });
    this.close(1008);
  }

  sendFrame(opcode, payload) {
    if (this.closed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this.leave();
    }
  }

  leave() {
    if (this.closed) return;
    this.closed = true;
    const room = this.listener.rooms.get(this.token);
    if (!room) return;
    if (room.host === this) {
      room.host = null;
      // 服务端页面关了：客户端不能继续显示旧数据，直接断开让它回到本地库
      for (const c of room.clients.values()) {
        c.reply({ t: 'error', error: '服务端已离线，请回到本地数据' });
        c.close(1011);
      }
      room.clients.clear();
    } else if (this.id) {
      room.clients.delete(this.id);
      room.host?.reply({ t: 'peer', event: 'leave', ...peerInfo(this) });
    }
    try {
      this.socket.destroy();
    } catch {
      /* ignore */
    }
  }

  close(code) {
    if (this.closed) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code, 0);
    this.sendFrame(0x8, b);
    this.leave();
  }
}

function peerInfo(c) {
  return { id: c.id, name: c.name, role: c.role };
}

// ---------------- 端口管理 ----------------

const ports = new Map();

async function openPort(port, token) {
  if (ports.has(port)) {
    // 同端口再次请求：允许更新 token（页面重开时 token 可能换了），
    // 但已有服务端在线时不能换——换了它就等于被静默踢下线。
    const existing = ports.get(port);
    const busy = [...existing.rooms.values()].some((r) => r.host);
    if (busy && token !== existing.token) return false;
    existing.token = token;
    return true;
  }
  const l = new Listener(port, token);
  try {
    await l.listen();
  } catch {
    return false;
  }
  ports.set(port, l);
  return true;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) out.push(item.address);
    }
  }
  return out;
}

async function main() {
  const ok = await openPort(PRIMARY_PORT, PRIMARY_TOKEN);
  if (!ok) {
    console.error(`[remote-relay] 端口 ${PRIMARY_PORT} 已被占用`);
    process.exit(1);
  }
  console.log(`[remote-relay] 已启动 端口=${PRIMARY_PORT} token=${PRIMARY_TOKEN}`);
  console.log(`[remote-relay] 静态目录=${DIST}`);
  console.log(`[remote-relay] 本机打开 http://127.0.0.1:${PRIMARY_PORT}/`);
  for (const ip of lanAddresses()) {
    console.log(`[remote-relay] 局域网设备打开 http://${ip}:${PRIMARY_PORT}/`);
  }
  console.log('[remote-relay] 服务端页面里填同样的端口和 token，再点「开启跨设备操作」');
}

process.on('SIGINT', async () => {
  for (const l of ports.values()) await l.close();
  process.exit(0);
});

main().catch((e) => {
  console.error('[remote-relay] 启动失败：', e);
  process.exit(1);
});
