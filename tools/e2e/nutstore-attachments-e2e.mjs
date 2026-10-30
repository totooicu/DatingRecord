// 坚果云附件同步（attachments/ 内容寻址那一层）的端到端回归。
//
// 要证的事，按「用户会不会吃亏」排序：
//   A1 第一次同步真把图片/文件的字节传上去了，传上去的内容和库里的字节一字不差
//      （对象名就是 sha256，所以「对不对」由 node 端独立算哈希复核，不信代码自己说）
//   A2 第二次同步：一个字节都不再传，只有「跳过」—— 内容寻址的整个卖点靠这条撑着
//   A2b 本机没改过（action = noop）时附件这一趟照样跑：新机器、只看不改的设备补字节全在这条路上
//   A3 本地字节丢了 → 同步当场从云端原样补回来
//   A4 云端某一片被截断 → 宁可不补，也绝不把错内容写进库；把对的一片传回去，下一趟就活了
//   A5 映射文件（只有外链没有字节）全程不参与，云端 attachments/ 里只有真上传过的那两个
//   A6 快照里带附件的元数据行（data 一律清空）—— 别的设备因此知道「有这张图」
//   A7 补算出的 sha256 当场落盘：把指纹抹掉并落盘，同步补算后**刷新页面**还在
//   A9 关掉开关 → 一个附件请求都不发，也不把别人传过的对象说成「没有」（清单作者仍是自己）
//   A10 设置页的开关默认开着（老库没这个键），关掉后结果表里不该出现附件行
//   A11 诊断工具 system.syncAttachments 可读、不含密码
//
// 假坚果云起在本进程里（临时端口），带跨域头 —— 桥和浏览器两条路都能打。
// 「壳」用 addInitScript 装：接 net.capabilities / net.request，用**原始 fetch** 代发
// （页面的 window.fetch 包了一层计数，所以「有没有走桥」是可证的）。
// 云端存了什么直接用进程内的 Map 查，不需要测试自己的后门。
//
// 用法：node tools/e2e/nutstore-attachments-e2e.mjs [dev-url]   默认 http://localhost:5174/
// 必须 Vite dev 服务（要动态 import 源码模块），不能用 preview。

import fs from 'node:fs';
import http from 'node:http';
import { createHash } from 'node:crypto';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const rest = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const APP = rest[0] || 'http://localhost:5174/';

const failures = [];
const check = (label, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
    failures.push(label);
  }
};

// ---------- 假坚果云 WebDAV ----------

const USER = 'tester@example.com';
const PASS = 'app-pass-123';
const BASIC = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
const ROOT = 'DatingRecord';
const NS = 'dav';
const PREFIX = `/${NS}/${ROOT}/`;
const ATT = `${PREFIX}attachments/`;

const files = new Map(); // '/dav/路径' -> { dir, size, body, ct }
const log = []; // { method, path, len, depth, auth }

const dirKey = (p) => p.replace(/\/+$/, '');

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('bad path');
    return;
  }
  const ns = pathname.split('/')[1] || '';
  const h = {
    'content-type': 'text/plain;charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,HEAD,PUT,POST,DELETE,OPTIONS,PROPFIND,MKCOL,COPY,MOVE,LOCK,UNLOCK',
    'access-control-allow-headers': 'Authorization,Content-Type,Depth,Overwrite,Destination',
    'access-control-max-age': '600',
  };

  let raw = [];
  req.on('data', (c) => raw.push(c));
  req.on('end', () => {
    const body = Buffer.concat(raw);
    const m = (req.method || '').toUpperCase();
    log.push({ method: m, path: pathname, len: body.length, depth: req.headers.depth ?? null, auth: req.headers.authorization === BASIC });

    if (m === 'OPTIONS') {
      res.writeHead(204, h).end('');
      return;
    }
    if (req.headers.authorization !== BASIC) {
      res.writeHead(401, { ...h, 'www-authenticate': 'Basic realm="dav"' }).end('需要应用密码');
      return;
    }
    if (m === 'MKCOL') {
      const k = dirKey(pathname);
      if (files.has(k)) {
        res.writeHead(405, h).end('already exists');
        return;
      }
      files.set(k, { dir: true, size: 0, body: null, ct: '' });
      res.writeHead(201, h).end('');
      return;
    }
    if (m === 'PROPFIND') {
      const k = dirKey(pathname);
      const esc = (s) => s.split('/').map(encodeURIComponent).join('/');
      const block = (href, dir, size) =>
        `<d:response><d:href>${href}</d:href><d:propstat><d:prop>` +
        `<d:resourcetype>${dir ? '<d:collection/>' : ''}</d:resourcetype>` +
        `<d:getcontentlength>${size}</d:getcontentlength>` +
        `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
      if (!files.has(k)) {
        res.writeHead(404, h).end('not found');
        return;
      }
      const kids = new Map();
      for (const x of [...files.keys()]) {
        if (x === k || !x.startsWith(`${k}/`)) continue;
        const tail = x.slice(k.length + 1);
        const seg = tail.split('/')[0];
        if (!seg) continue;
        const v = files.get(x);
        kids.set(seg, tail.includes('/') ? { dir: true, size: 0 } : { dir: !!v.dir, size: v.size });
      }
      const head = `/${ns}/${esc(pathname.slice(1 + ns.length))}`;
      const xml =
        `<?xml version="1.0" encoding="utf-8"?<d:multistatus xmlns:d="DAV:">` +
        block(`${head}/`, true, 0) +
        [...kids.entries()].map(([seg, v]) => block(`${head}/${seg}`, v.dir, v.size)).join('') +
        `</d:multistatus>`;
      res.writeHead(207, { ...h, 'content-type': 'application/xml;charset=utf-8', 'content-length': Buffer.byteLength(xml) }).end(xml);
      return;
    }
    if (m === 'PUT') {
      const k = dirKey(pathname);
      const existed = files.has(k);
      files.set(k, { dir: false, size: body.length, body, ct: req.headers['content-type'] || '' });
      res.writeHead(existed ? 204 : 201, { ...h, etag: `"${body.length.toString(16)}"` }).end('');
      return;
    }
    if (m === 'GET' || m === 'HEAD') {
      const v = files.get(dirKey(pathname));
      if (!v || v.dir) {
        res.writeHead(404, h).end(m === 'HEAD' ? '' : 'not found');
        return;
      }
      res.writeHead(200, { ...h, 'content-type': v.ct || 'application/octet-stream', 'content-length': v.size }).end(
        m === 'HEAD' ? '' : v.body,
      );
      return;
    }
    if (m === 'DELETE') {
      const k = dirKey(pathname);
      if (!files.has(k)) {
        res.writeHead(404, h).end('not found');
        return;
      }
      for (const x of [...files.keys()]) if (x === k || x.startsWith(`${k}/`)) files.delete(x);
      res.writeHead(204, h).end('');
      return;
    }
    res.writeHead(501, h).end(`假坚果云不认 ${m}`);
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const CFG = { base: `http://127.0.0.1:${PORT}/${NS}`, user: USER, password: PASS, folder: ROOT };

// 云端此刻存了什么（进程内直查）
const remoteBuf = (p) => files.get(`${PREFIX}${p}`)?.body ?? null;
const remoteText = (p) => {
  const b = remoteBuf(p);
  return b ? b.toString('utf8') : null;
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
/** 从 log 的第 from 条往后， attachments/ 上的请求长什么样 */
const attLog = (from) => log.slice(from).filter((r) => r.path.startsWith(ATT)).map((r) => `${r.method} ${r.path.slice(PREFIX.length)}(${r.len})`);
const countFrom = (from, pred) => log.slice(from).filter(pred).length;
/** 附件切片的写入（路径里是 64 位哈希） */
const partWrites = (from) => countFrom(from, (r) => r.method === 'PUT' && new RegExp(`^${ATT}[0-9a-f]{64}/`).test(r.path));
/** 清单本身的写入 */
const indexWrites = (from) => countFrom(from, (r) => r.method === 'PUT' && r.path === `${ATT}index.json`);

console.log(`假坚果云 WebDAV：http://127.0.0.1:${PORT}/${NS}（带跨域头，桥和浏览器两条路都能打）`);

// ---------- 假壳：接 net.*，用原始 fetch 代发 ----------

const SHELL = `
(() => {
  const rawFetch = window.fetch.bind(window);
  window.__fetchCount = 0;
  window.fetch = (...a) => { window.__fetchCount += 1; return rawFetch(...a); };
  window.__netCalls = [];

  const b64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return btoa(s);
  };
  const unb64 = (t) => {
    const bin = atob(t);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  };
  const CAPS = {
    methods: { GET: true, HEAD: true, PUT: true, POST: true, DELETE: true, OPTIONS: true,
      PROPFIND: true, MKCOL: true, COPY: true, MOVE: true, LOCK: true, UNLOCK: true, PROPPATCH: true, TRACE: true, PATCH: true },
    maxRequestBytes: 12582912,
    maxResponseBytes: 33554432,
    maxTimeoutMs: 120000,
    version: '1.2.0',
  };
  const reply = (id, ok, result, error) =>
    window.postMessage({ type: 'gv-bridge-response', id, ok, result, error }, '*');

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.type !== 'gv-bridge-request') return;
    window.__netCalls.push({ action: m.action, params: m.params });
    if (m.action === 'ping') return reply(m.id, true, { pong: true, shell: 'mock' });
    if (m.action === 'net.capabilities') {
      setTimeout(() => reply(m.id, true, CAPS), 80);
      return;
    }
    if (m.action === 'net.request') {
      const p = m.params || {};
      const init = { method: p.method, headers: p.headers || undefined };
      if (p.bodyBase64) init.body = unb64(p.bodyBase64);
      rawFetch(p.url, init)
        .then(async (res) => {
          const buf = new Uint8Array(await res.arrayBuffer());
          const headers = {};
          res.headers.forEach((v, k) => { headers[k] = v; });
          reply(m.id, true, { status: res.status, statusText: res.statusText || '', headers,
            bodyLength: buf.length, bodyBase64: b64(buf) });
        })
        .catch((err) => reply(m.id, false, null, '连不上服务器：' + String((err && err.message) || err)));
      return;
    }
    return reply(m.id, false, null, 'mock 不认这个 action：' + m.action);
  });
})();
`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});

const pageErrors = [];
const ctx = await browser.newContext({ viewport: { width: 900, height: 1300 } });
await ctx.addInitScript(SHELL);
const p = await ctx.newPage();
p.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
p.on('dialog', (d) => d.accept());

const waitBoot = () =>
  p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 120000 },
  );
const fetchCount = () => p.evaluate(() => window.__fetchCount);
/** 刷新页面会把 window 上的临时东西清掉，重新装一次（内容生成器 + 播种记录的 id） */
const reinstall = (ids) =>
  p.evaluate(([o]) => {
    window.__mk = (n) => {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) b[i] = (i * 1103515245 + 12345 + (i % 7) * 17) & 0xff;
      return b;
    };
    window.__seedIds = o;
  }, [ids]);

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();

const syncNow = (opts) =>
  p.evaluate(async ([conf, o]) => {
    const { syncNow: run } = await import('/src/core/sync/engine.ts');
    return await run(conf, o);
  }, [CFG, opts]);

const gotoSync = async () => {
  if (!(await p.locator('.tabbar-item', { hasText: '设置' }).count())) {
    await p.getByText('导入已有备份').click();
    await p.waitForTimeout(600);
  }
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-nav-title', { hasText: '备份与分享' }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: '坚果云备份' }).first().click();
  await p.waitForTimeout(900);
};

// ---------- 播种：两个带字节的附件 + 一个映射文件 ----------

const seed = await p.evaluate(async () => {
  const { Sha256 } = await import('/src/core/sync/sha256.ts');
  const { insertFileRaw, insertMappedFile } = await import('/src/core/repo/files.ts');
  window.__mk = (n) => {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) b[i] = (i * 1103515245 + 12345 + (i % 7) * 17) & 0xff;
    return b;
  };
  const hex = (u8) => {
    const h = new Sha256();
    for (let i = 0; i < u8.length; i += 1048576) h.update(u8.subarray(i, i + 1048576));
    return h.hex();
  };
  const bytes = window.__mk(12 * 1024);
  const hash = hex(bytes);
  const a = await insertFileRaw({
    file: new Blob([bytes], { type: 'image/jpeg' }),
    name: '海边的下午.jpg',
    storedId: '海边的下午.jpg',
    sha256: hash,
  });
  // 老库导入的常见样子：只有 name / size，sha256 空着
  const lb = window.__mk(3000);
  const legacy = await insertFileRaw({
    file: new Blob([lb], { type: 'application/octet-stream' }),
    name: '老记录.bin',
    storedId: '老记录.bin',
    sha256: '',
  });
  const mapped = insertMappedFile({
    name: '外链的图.jpg',
    sourceUrl: 'https://example.com/x.jpg',
    storedId: '外链的图.jpg',
    mime: 'image/jpeg',
    size: 999,
  });
  const out = { a: a.id, legacy: legacy.id, mapped: mapped.id, hash, legacyHash: hex(lb), size: bytes.length, legacySize: lb.length };
  window.__seedIds = out;
  return out;
});
check('播种：两个带字节的附件 + 一个映射文件', seed.hash.length === 64 && seed.legacyHash.length === 64 && seed.a !== seed.mapped, JSON.stringify(seed));

// ---------- A10 开关默认开着；A1 由页面上点出来的第一次同步完成 ----------

console.log('\nA10 设置页：附件开关默认开着');
await gotoSync();
const attBox = p.getByRole('checkbox', { name: /同步附件的图片与文件/ });
const hasBox = (await attBox.count()) === 1;
check('页面上有这一项', hasBox, `找到 ${await attBox.count()} 个`);
check('默认是开的（老库没这个键，就该跟着「文件也要上传」走）', hasBox && (await attBox.isChecked()));
const hintTxt = (await p.locator('.sync-attach-hint').count()) ? await p.locator('.sync-attach-hint').innerText() : '';
check('说明写清「只传一次」和关掉的后果', /只传一次/.test(hintTxt) && /别的设备/.test(hintTxt), hintTxt.replace(/\n/g, ' | ').slice(0, 160));

await p.getByLabel(/坚果云账号/).fill(USER);
await p.getByLabel(/应用密码/).fill(PASS);
await p.locator('.sync-advanced summary').click();
await p.waitForTimeout(300);
await p.getByLabel(/WebDAV 地址/).fill(CFG.base);
await p.locator('.sync-advanced summary').click();
await p.waitForTimeout(300);

const f0 = await fetchCount();
const m1 = log.length;
await p.locator('button.btn-primary', { hasText: '立即同步' }).click();
await p.waitForSelector('.sync-result', { timeout: 120000 });
const ui1 = await p.locator('.sync-result').innerText();

console.log('\nA1 第一次同步：字节真传上去了');
const idx1 = JSON.parse(remoteText('attachments/index.json') || '{}');
const partA = remoteBuf(`attachments/${seed.hash}/0.bin`);
const partL = remoteBuf(`attachments/${seed.legacyHash}/0.bin`);
check('结果表里报了「附件上传 2 个」', /附件上传[\s\S]{0,40}2 个/.test(ui1), ui1.replace(/\s+/g, ' ').slice(0, 240));
check('云端清单里有 2 个对象', Object.keys(idx1.files || {}).length === 2, JSON.stringify(idx1).slice(0, 200));
check('第一个对象：名字就是内容的 sha256，node 端复核字节一致', !!partA && partA.length === seed.size && sha(partA) === seed.hash, partA ? `${partA.length} B` : '缺片');
check('老库那个没算过指纹的：当场补算并传了', !!partL && sha(partL) === seed.legacyHash && idx1.files?.[seed.legacyHash]?.s === seed.legacySize, partL ? `${partL.length} B` : '缺片');
const man1 = JSON.parse(remoteText('manifest.json') || '{}');
check('清单写着云端有附件', man1.hasAttachments === true, JSON.stringify(man1).slice(0, 200));
check('附件往返全程走桥，没碰页面 window.fetch', (await fetchCount()) === f0, `fetch ${await fetchCount()} vs ${f0}`);
check('attachments/ 上恰好两片 + 一份清单', partWrites(m1) === 2 && indexWrites(m1) === 1, JSON.stringify(attLog(m1)));
check('快照分片里能看到附件行（清单 kind 仍是 lite）', man1.kind === 'lite', JSON.stringify(man1).slice(0, 120));

// ---------- A2 第二次同步 ----------

console.log('\nA2 / A2b 第二次同步：只有跳过');
const m2 = log.length;
const a2 = await syncNow({ attachments: true });
check('本机没改过 → action 是 noop', a2.action === 'noop', JSON.stringify(a2).slice(0, 200));
check('noop 这条路上附件照样跑了：2 个跳过、0 字节上传', a2.attachments?.skipped === 2 && a2.attachments?.uploaded === 0 && a2.attachments?.uploadBytes === 0, JSON.stringify(a2.attachments));
check('云端 attachments/ 零写入切片', partWrites(m2) === 0 && indexWrites(m2) === 0, JSON.stringify(attLog(m2)));
check('fetched / missingRemote 都是 0（本地字节本来就齐）', a2.attachments?.fetched === 0 && a2.attachments?.missingRemote === 0, JSON.stringify(a2.attachments));

// ---------- A3 本地丢了字节 ----------

console.log('\nA3 本地字节丢了 → 从云端原样补回来');
const a3 = await p.evaluate(async (conf) => {
  const { delBlob, getBlob } = await import('/src/core/db/blob.ts');
  await delBlob(window.__seedIds.a);
  const { syncNow } = await import('/src/core/sync/engine.ts');
  const r = await syncNow(conf, { attachments: true });
  const back = await getBlob(window.__seedIds.a);
  const { Sha256 } = await import('/src/core/sync/sha256.ts');
  let hash = '';
  if (back) {
    const bytes = new Uint8Array(await back.arrayBuffer());
    const h = new Sha256();
    h.update(bytes);
    hash = h.hex();
  }
  return { att: r.attachments, action: r.action, size: back?.size ?? -1, hashOk: hash === window.__seedIds.hash };
}, CFG);
check('补回 1 个，字节数与内容都对', a3.att?.fetched === 1 && a3.size === seed.size && a3.hashOk, JSON.stringify(a3));
check('这一趟没有再上传', (a3.att?.uploaded ?? -1) === 0, JSON.stringify(a3.att));

// ---------- A4 云端片被截断 ----------

console.log('\nA4 云端片被截断：宁可缺着，也不把错内容写进库');
const a4 = await p.evaluate(async (conf) => {
  const { delBlob, getBlob } = await import('/src/core/db/blob.ts');
  await delBlob(window.__seedIds.a);
  const dav = await import('/src/core/sync/webdav.ts');
  // 模拟「上次传到一半断了」：清单说 12KB，实体只有 1000B
  await dav.putBinary(conf, `attachments/${window.__seedIds.hash}/0.bin`, window.__mk(1000));
  const { syncNow } = await import('/src/core/sync/engine.ts');
  const bad = await syncNow(conf, { attachments: true });
  const stillEmpty = (await getBlob(window.__seedIds.a)) === null;
  // 把对的一片传回去，下一趟就该活了
  await dav.putBinary(conf, `attachments/${window.__seedIds.hash}/0.bin`, window.__mk(window.__seedIds.size));
  const good = await syncNow(conf, { attachments: true });
  const back = await getBlob(window.__seedIds.a);
  return { bad: bad.attachments, stillEmpty, good: good.attachments, size: back?.size ?? -1 };
}, CFG);
check('清单说有、片只有 1000B → 报缺，库里没落下坏字节', a4.stillEmpty === true && (a4.bad?.fetched ?? -1) === 0 && a4.bad?.missingRemote === 1, JSON.stringify(a4));
check('云端修好后下一趟补回来', a4.good?.fetched === 1 && a4.size === seed.size, JSON.stringify({ good: a4.good, size: a4.size }));

// ---------- A5 映射文件 ----------

console.log('\nA5 映射文件全程不参与');
const idxNow = JSON.parse(remoteText('attachments/index.json') || '{}');
check('云端只有那两个真附件，没替外链造对象', Object.keys(idxNow.files || {}).length === 2, JSON.stringify(Object.keys(idxNow.files || {})));
check('清单里的两个哈希就是播种那两个', !!idxNow.files?.[seed.hash] && !!idxNow.files?.[seed.legacyHash], JSON.stringify(Object.keys(idxNow.files || {})));

// ---------- A6 快照里的附件元数据 ----------

console.log('\nA6 快照带附件元数据（别的设备才知道「有这张图」）');
const snapKeys = [...files.keys()].filter((k) => k.startsWith(`${PREFIX}snapshots/`)).sort();
const snap = JSON.parse(remoteText(`${snapKeys[snapKeys.length - 1].slice(PREFIX.length)}`) || '{}');
const attRows = snap.attachments || [];
check('历史快照里有 attachments 行（以前是空数组，别的设备一个文件都看不见）', attRows.length >= 3, `${attRows.length} 行`);
check('data 一律清空，字节不跟着快照走', attRows.every((x) => !x.data), JSON.stringify(attRows.map((x) => (x.data || '').length)));
check('映射文件也在行里（带 sourceUrl，没有字节）', attRows.some((x) => x.sourceUrl === 'https://example.com/x.jpg'), JSON.stringify(attRows.map((x) => x.name)));
check('指纹也在行里，别的设备据此知道该去拉哪个对象', attRows.some((x) => x.sha256 === seed.hash), JSON.stringify(attRows.map((x) => x.sha256?.slice(0, 8))));

// ---------- A7 补算的指纹真的落盘 ----------

console.log('\nA7 补算出的指纹当场落盘（刷新页面还在）');
const a7 = await p.evaluate(async (conf) => {
  const { persist, run } = await import('/src/core/db/index.ts');
  // 抹掉一个指纹并且落盘：这样「刷新后还在」只能靠同步时的 persist 做到
  run('UPDATE attachments SET sha256 = ? WHERE id = ?', ['', window.__seedIds.a]);
  await persist();
  const { syncNow } = await import('/src/core/sync/engine.ts');
  const r = await syncNow(conf, { full: true, attachments: true });
  return { hashed: r.attachments?.hashed ?? -1, uploaded: r.attachments?.uploaded ?? -1, skipped: r.attachments?.skipped ?? -1 };
}, CFG);
check('指纹被抹掉后：云端已有同内容 → 补算但不重传（两个都归到跳过）', a7.hashed === 1 && a7.uploaded === 0 && a7.skipped === 2, JSON.stringify(a7));
await p.reload({ waitUntil: 'load' });
await waitBoot();
await reinstall(seed);
const a7b = await p.evaluate(async () => {
  const { queryAll } = await import('/src/core/db/index.ts');
  // 这里跑的是浏览器里的 JS，不能写 TS 泛型
  return queryAll('SELECT sha256 FROM attachments WHERE id = ?', [window.__seedIds.a])[0]?.sha256 ?? null;
});
check('刷新一次后指纹仍在表里（真的写进 IndexedDB 了）', a7b === seed.hash, String(a7b));

// ---------- A9 / A10b 关掉开关 ----------

console.log('\nA9 关掉开关：一个附件请求都不发');
await gotoSync();
const box2 = p.getByRole('checkbox', { name: /同步附件的图片与文件/ });
check('刷新后开关还开着（设置存在 meta 表里，跟着这个库走）', await box2.isChecked());
const m9 = log.length;
await box2.click();
await p.waitForTimeout(200);
await p.locator('button.btn-primary', { hasText: '立即同步' }).click();
await p.waitForSelector('.sync-result', { timeout: 120000 });
const ui9 = await p.locator('.sync-result').innerText();
check('关着点同步：attachments/ 零请求', countFrom(m9, (r) => r.path.startsWith(ATT)) === 0, JSON.stringify(attLog(m9)));
check('结果表里不再出现附件行', !/附件上传|附件跳过/.test(ui9), ui9.replace(/\s+/g, ' ').slice(0, 200));

const m9b = log.length;
await p.locator('button.btn', { hasText: '强制完整上传' }).click();
await p.waitForTimeout(1500);
const man9 = JSON.parse(remoteText('manifest.json') || '{}');
check('强制完整上传时也没有附件请求', countFrom(m9b, (r) => r.path.startsWith(ATT)) === 0, JSON.stringify(attLog(m9b)));
check('开关关着也不会把别人传过的对象说成「没有」', man9.hasAttachments === true, JSON.stringify(man9).slice(0, 200));

// ---------- A11 诊断工具 ----------

console.log('\nA11 system.syncAttachments');
const a11 = await p.evaluate(async () => {
  const { callTool } = await import('/src/core/tools/registry.ts');
  return await callTool('system.syncAttachments');
});
check('工具可调、不写库', a11.ok === true, JSON.stringify(a11).slice(0, 200));
check('报出开关状态与本地家底（2 有字节 / 1 映射）', a11.data?.enabled === false && a11.data?.haveBytes === 2 && a11.data?.mapped === 1, JSON.stringify(a11.data));
check('结果里没有密码', !JSON.stringify(a11.data).includes(PASS), JSON.stringify(a11.data).slice(0, 160));

await ctx.close();
await browser.close();
server.close();

check('全程没有页面错误', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\n========== 汇总 ==========\n${failures.length ? `失败 ${failures.length} 项：${failures.join(' / ')}` : '全部通过 ✓'}`);
process.exit(failures.length ? 1 : 0);
