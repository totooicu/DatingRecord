// 壳的网络代理（桥的 net.*）跑坚果云 WebDAV 的端到端回归。
//
// 要证的事，按用户实际会踩的顺序：
//   B1 网页的请求真的走桥，不再走浏览器 fetch（坚果云不给跨域头，走 fetch 必死）
//   B2 探测只问一次：一次同步几十条请求，不能每条都问一遍 net.capabilities
//   B3 64KB 二进制分片穿过 base64 收发，字节不差一个
//   B4 PROPFIND 207 的 multistatus 能被 list() 解析出名字/大小/目录
//   B5 401 仍然翻成「应用密码」那句话（换通道不能把已有提示弄丢）
//   B6 壳报的错误原样上抛，不套 CORS 说辞（错在网络上却让用户去配反代，是最坏的提示）
//   B9 测试连接（建目录 + 列目录）整条走通
//   B10/B11 诊断入口 system.syncChannel：有壳报 shellNet、无壳报 browserFetch，且不带密码
//   B12 整轮 syncNow 真跑完：第一轮 upload、第二轮 noop（subarray 视图过 base64 不错位）
//   B7 没有壳时退回浏览器 fetch：服务端给跨域头（反代）就照常同步
//   B8 没有壳且服务端不给跨域头时，报错要说清两条出路
//   U1/U2 设置页顶上的「传输通道」一行，两种环境下分别显示「由壳代发」「浏览器直连」，
//          三档宽度（390 / 820 / 1440）都在
//
// 假坚果云起在本进程里（临时端口），两条命名空间：
//   /cors/*   —— 返回跨域头，模拟自建反代
//   /nocors/* —— 不返回跨域头，模拟真实坚果云
// 「壳」用 addInitScript 装：接 net.capabilities / net.request，并用**原始 fetch**
// 代发（页面自己的 fetch 被包了一层计数，所以「有没有走桥」是可证的）。
// 假壳毕竟跑在页面里，它自己发请求也受跨域约束，所以走桥的用例只能打在 /cors 上：
//   · 「确实交给桥了」= 页面的 window.fetch 一次都没被调用，请求记录全在 net.request 上
//   · /nocors 只用来验「没有壳时浏览器的死路会报成什么」——那正是真实坚果云的样子
// 壳那侧真正的 HTTP 实现（非标准动词、chunked、超时）由壳仓库 tools/net-http-test/ 覆盖。
//
// 用法：node tools/e2e/nutstore-bridge-e2e.mjs [dev-url]   默认 http://localhost:5174/
// 必须 Vite dev 服务（要动态 import 源码模块），不能用 preview。

import fs from 'node:fs';
import http from 'node:http';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const APP = process.argv[2] || 'http://localhost:5174/';

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

const files = new Map(); // 'ns/路径' -> { dir, size, body, ct }
const log = []; // { method, path, ns, len, depth, auth }

const dirKey = (ns, pathname) => `${ns}${pathname.replace(/\/+$/, '')}`;

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('bad path');
    return;
  }
  const ns = pathname.split('/')[1] || '';

  // /__log 与 /__reset 是测试自己的后门，不参与同步
  if (ns === '__log') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(log));
    return;
  }
  if (ns === '__reset') {
    files.clear();
    log.length = 0;
    res.writeHead(200).end('ok');
    return;
  }

  const cors = ns === 'cors';
  const h = { 'content-type': 'text/plain;charset=utf-8' };
  if (cors) {
    h['access-control-allow-origin'] = '*';
    h['access-control-allow-methods'] = 'GET,HEAD,PUT,POST,DELETE,PROPFIND,MKCOL,COPY,MOVE,OPTIONS';
    h['access-control-allow-headers'] = 'Authorization,Content-Type,Depth,Overwrite,Destination';
    h['access-control-max-age'] = '600';
  }

  let raw = [];
  req.on('data', (c) => raw.push(c));
  req.on('end', () => {
    const body = Buffer.concat(raw);
    const m = (req.method || '').toUpperCase();
    log.push({
      method: m,
      path: pathname,
      ns,
      len: body.length,
      depth: req.headers.depth ?? null,
      auth: req.headers.authorization === BASIC,
    });

    if (m === 'OPTIONS') {
      // 没有跨域许可时预检就过不去，回什么都无所谓——浏览器照样拦
      res.writeHead(cors ? 204 : 403, h).end(cors ? '' : 'no cors');
      return;
    }
    if (req.headers.authorization !== BASIC) {
      res.writeHead(401, { ...h, 'www-authenticate': 'Basic realm="dav"' }).end('需要应用密码');
      return;
    }

    if (m === 'MKCOL') {
      const k = dirKey(ns, pathname);
      if (files.has(k)) {
        res.writeHead(405, h).end('already exists'); // 坚果云的「已存在」
        return;
      }
      files.set(k, { dir: true, size: 0, body: null, ct: '' });
      res.writeHead(201, h).end('');
      return;
    }

    if (m === 'PROPFIND') {
      const k = dirKey(ns, pathname);
      const esc = (s) => s.split('/').map(encodeURIComponent).join('/');
      const block = (href, dir, size) =>
        `<d:response><d:href>${href}</d:href><d:propstat><d:prop>` +
        `<d:resourcetype>${dir ? '<d:collection/>' : ''}</d:resourcetype>` +
        `<d:getcontentlength>${size}</d:getcontentlength>` +
        `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
      // 路径里还没建过目录时，坚果云回 404；网页侧把 404 当「空目录」
      const inside = [...files.keys()].filter((x) => x === k || x.startsWith(`${k}/`));
      if (!files.has(k)) {
        res.writeHead(404, h).end('not found');
        return;
      }
      const kids = new Map();
      for (const x of inside) {
        if (x === k) continue;
        const rest = x.slice(k.length + 1);
        const seg = rest.split('/')[0];
        if (!seg) continue;
        const v = files.get(x);
        kids.set(seg, rest.includes('/') ? { dir: true, size: 0 } : { dir: !!v.dir, size: v.size });
      }
      const xml =
        `<?xml version="1.0" encoding="utf-8"?` +
        `<d:multistatus xmlns:d="DAV:">${block(`/${ns}/${esc(pathname.slice(1 + ns.length))}/`, true, 0)}` +
        [...kids.entries()]
          .map(([seg, v]) => block(`/${ns}/${esc(pathname.slice(1 + ns.length))}/${seg}`, v.dir, v.size))
          .join('') +
        `</d:multistatus>`;
      res.writeHead(207, { ...h, 'content-type': 'application/xml;charset=utf-8', 'content-length': Buffer.byteLength(xml) }).end(xml);
      return;
    }

    if (m === 'PUT') {
      const k = dirKey(ns, pathname);
      const existed = files.has(k);
      files.set(k, { dir: false, size: body.length, body, ct: req.headers['content-type'] || '' });
      res.writeHead(existed ? 204 : 201, { ...h, etag: `"${body.length.toString(16)}"` }).end('');
      return;
    }

    if (m === 'GET' || m === 'HEAD') {
      const v = files.get(dirKey(ns, pathname));
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
      const k = dirKey(ns, pathname);
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
const BASE = (ns) => `http://127.0.0.1:${PORT}/${ns}`;
const cfg = (ns, over = {}) => ({ base: BASE(ns), user: USER, password: PASS, folder: ROOT, ...over });

console.log(`假坚果云 WebDAV：http://127.0.0.1:${PORT}（/cors 给跨域头，/nocors 不给）`);

// ---------- 假壳：接 net.*，用原始 fetch 代发 ----------

const SHELL = (withBridge) => `
(() => {
  const rawFetch = window.fetch.bind(window);
  window.__fetchCount = 0;
  window.fetch = (...a) => { window.__fetchCount += 1; return rawFetch(...a); };
  window.__netCalls = [];
  window.__capsCalls = 0;
  ${withBridge ? '' : 'return;'}

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
      window.__capsCalls += 1;
      setTimeout(() => reply(m.id, true, CAPS), 80); // 壳那边也是异步的
      return;
    }
    if (m.action === 'net.request') {
      const p = m.params || {};
      // 壳侧网络错误：错误串已经在壳里写成给用户看的话，网页不许再翻译
      if (String(p.url).indexOf('__shellerr') >= 0) {
        return reply(m.id, false, null, '坚果云响应超时，检查一下网络再试');
      }
      const init = { method: p.method, headers: p.headers || undefined };
      if (p.bodyBase64) init.body = unb64(p.bodyBase64);
      rawFetch(p.url, init)
        .then(async (res) => {
          const buf = new Uint8Array(await res.arrayBuffer());
          const headers = {};
          res.headers.forEach((v, k) => { headers[k] = v; });
          reply(m.id, true, {
            status: res.status,
            statusText: res.statusText || '',
            headers,
            bodyLength: buf.length,
            bodyBase64: b64(buf),
          });
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

const waitBoot = async (p) => {
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 120000 },
  );
};

const counters = (page) =>
  page.evaluate(() => ({
    fetch: window.__fetchCount,
    net: (window.__netCalls || []).filter((c) => c.action === 'net.request').length,
    caps: window.__capsCalls,
    actions: (window.__netCalls || []).map((c) => c.action),
  }));

// 页面启动本身要拉 wasm、拉 version.json，这些 fetch 不能算到同步头上，
// 所以每组用例前先清零，之后只看增量。
const zero = (page) =>
  page.evaluate(() => {
    window.__fetchCount = 0;
    window.__netCalls = [];
    window.__capsCalls = 0;
  });

const serverLog = async () => {
  const r = await fetch(`${BASE('cors').replace(/\/cors$/, '')}/__log`);
  return r.json();
};
const resetServer = async () => {
  await fetch(`${BASE('cors').replace(/\/cors$/, '')}/__reset`);
};

const pageErrors = [];
const mkPage = async (withBridge, width = 390, height = 844) => {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(SHELL(withBridge));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  p.on('dialog', (d) => d.accept());
  return { ctx, p };
};

// ---------- B1–B6 + B9：有壳，走桥 ----------

await resetServer();
console.log('\nB1/B2 走桥不走 fetch，探测只问一次');
const { ctx: c1, p } = await mkPage(true);
await p.goto(APP, { waitUntil: 'load' });
await waitBoot(p);
await zero(p);

const b1 = await p.evaluate(async (conf) => {
  const dav = await import('/src/core/sync/webdav.ts');
  await dav.ensureDir(conf, 'chunks');
  await dav.putText(conf, 'manifest.json', JSON.stringify({ v: 1, 名字: '桥测试' }));
  const text = await dav.getText(conf, 'manifest.json');
  return { text, channel: await (await import('/src/core/sync/nativeHttp.ts')).currentChannel() };
}, cfg('cors'));

const k1 = await counters(p);
check('请求全部交给桥（页面 window.fetch 0 次）', k1.fetch === 0, JSON.stringify(k1));
check('net.request 发了 4 次（建两级目录 + PUT + GET）', k1.net === 4, JSON.stringify(k1));
check('net.capabilities 只问过 1 次（结果被缓存）', k1.caps === 1, JSON.stringify(k1));
check('读回的内容与写入一致（含中文）', b1.text === JSON.stringify({ v: 1, 名字: '桥测试' }), String(b1.text));
check('通道判定为壳代发，且带上壳版本', b1.channel?.native === true && b1.channel?.version === '1.2.0', JSON.stringify(b1.channel));
const lg1 = await serverLog();
check(
  '服务端收到的是真 MKCOL/PUT/GET（不是浏览器代发的简化版）',
  ['MKCOL', 'PUT', 'GET'].every((m) => lg1.some((r) => r.method === m)),
  JSON.stringify(lg1.map((r) => r.method)),
);

console.log('\nB3 64KB 二进制分片过 base64');
const b3 = await p.evaluate(async (conf) => {
  const dav = await import('/src/core/sync/webdav.ts');
  const bytes = new Uint8Array(65536);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 37 + 11) & 0xff;
  await dav.putBinary(conf, 'chunks/ab/abcdef.bin', bytes);
  const back = await dav.getBinary(conf, 'chunks/ab/abcdef.bin');
  const sum = (u) => u.reduce((a, b) => (a + b) % 65521, 0);
  return { len: back?.length ?? -1, same: back?.length === bytes.length && back.every((v, i) => v === bytes[i]), sumBefore: sum(bytes), sumAfter: sum(back ?? new Uint8Array()) };
}, cfg('cors'));
check('读回 65536 字节且逐字节相同', b3.len === 65536 && b3.same === true, JSON.stringify(b3));
check('校验和相同（base64 没吃掉尾巴）', b3.sumBefore === b3.sumAfter, JSON.stringify(b3));
const lg3 = await serverLog();
check('服务端确实收到 65536 字节请求体', lg3.some((r) => r.method === 'PUT' && r.len === 65536), JSON.stringify(lg3.filter((r) => r.method === 'PUT')));

console.log('\nB4 PROPFIND 207 能被 list() 解析');
const b4 = await p.evaluate(async (conf) => {
  const dav = await import('/src/core/sync/webdav.ts');
  return await dav.list(conf, '');
}, cfg('cors'));
const names = b4.map((e) => e.name);
check('列出 manifest.json', names.includes('manifest.json'), JSON.stringify(b4));
check('列出目录 chunks（resourcetype 判成目录）', b4.some((e) => e.name === 'chunks' && e.isDir), JSON.stringify(b4));
check('文件的大小取到 getcontentlength', b4.filter((e) => !e.isDir).every((e) => e.size > 0), JSON.stringify(b4));
const lg4 = await serverLog();
check(
  '服务端收到的真是 PROPFIND 且带 Depth: 1（浏览器 fetch 发不出这一条）',
  lg4.some((r) => r.method === 'PROPFIND' && r.depth === '1'),
  JSON.stringify(lg4.map((r) => `${r.method}${r.depth ? `[${r.depth}]` : ''}`)),
);

console.log('\nB5 应用密码不对：仍然翻成原来那句提示');
const b5 = await p.evaluate(async (conf) => {
  const dav = await import('/src/core/sync/webdav.ts');
  try {
    await dav.getText(conf, 'manifest.json');
    return { msg: '(没报错)' };
  } catch (e) {
    return { msg: String(e.message || e) };
  }
}, cfg('cors', { password: 'wrong-pass' }));
check('报错说清是应用密码', b5.msg.includes('应用密码'), b5.msg);

console.log('\nB6 壳报的网络错误原样上抛（不许套成跨域问题）');
const b6 = await p.evaluate(async (conf) => {
  const dav = await import('/src/core/sync/webdav.ts');
  try {
    await dav.getText(conf, 'manifest.json');
    return { msg: '(没报错)' };
  } catch (e) {
    return { msg: String(e.message || e) };
  }
}, { ...cfg('cors'), folder: `${ROOT}__shellerr` });
check('错误串就是壳那句话', b6.msg === '坚果云响应超时，检查一下网络再试', b6.msg);
check('没有被改写成跨域提示', !b6.msg.includes('跨域') && !b6.msg.includes('CORS'), b6.msg);

console.log('\nB9 测试连接：建目录 + 列目录整条走桥');
const k9before = await counters(p);
const b9 = await p.evaluate(async (conf) => {
  const dav = await import('/src/core/sync/webdav.ts');
  await dav.testConnection(conf);
  return true;
}, cfg('cors'));
const k9 = await counters(p);
check('testConnection 通过', b9 === true);
check('之后的请求继续走桥、不再重复探测', k9.fetch === k9before.fetch && k9.net > k9before.net && k9.caps === 1, JSON.stringify({ before: k9before, after: k9 }));

console.log('\nB10 诊断入口 system.syncChannel：AI / CLI / 页面同一个答案');
const b10 = await p.evaluate(async () => {
  const { callTool } = await import('/src/core/tools/registry.ts');
  return await callTool('system.syncChannel');
});
check('工具可调、不写库', b10.ok === true, JSON.stringify(b10));
check('结论是 shellNet 并带壳版本', b10.data?.channel === 'shellNet' && b10.data?.shellVersion === '1.2.0', JSON.stringify(b10.data));
check('结论里没有密码', !JSON.stringify(b10.data).includes('app-pass-123'), JSON.stringify(b10.data));

console.log('\nB12 整轮同步真的跑完（engine 传的是 subarray 视图，最容易在 base64 上错位）');
// 前面几组用例往同一个目录塞过假 manifest，engine 会当损坏文件拒绝——先清空云端
await resetServer();
const k12before = await counters(p);
const b12 = await p.evaluate(async (conf) => {
  const { syncNow } = await import('/src/core/sync/engine.ts');
  const first = await syncNow(conf, { full: true });
  const again = await syncNow(conf, { full: false });
  return { a1: first.action, up1: first.uploadedChunks, total1: first.totalBytes, a2: again.action, up2: again.uploadedChunks };
}, cfg('cors'));
const k12 = await counters(p);
check('第一轮判成上传且有内容', b12.a1 === 'upload' && b12.up1 > 0 && b12.total1 > 0, JSON.stringify(b12));
check('第二轮一字未改 → noop（云端分片哈希对得上）', b12.a2 === 'noop' && b12.up2 === 0, JSON.stringify(b12));
check('整轮同步没碰页面 window.fetch', k12.fetch === k12before.fetch, JSON.stringify({ before: k12before, after: k12 }));
const lg12 = await serverLog();
check(
  'manifest 与分片都真落到服务端了',
  lg12.some((r) => r.method === 'PUT' && /manifest\.json$/.test(r.path)) && lg12.some((r) => r.method === 'PUT' && /\/chunks\//.test(r.path)),
  JSON.stringify(lg12.filter((r) => r.method === 'PUT').map((r) => `${r.path}(${r.len})`)),
);

// ---------- U1 设置页的通道一行 ----------

const gotoSync = async (page) => {
  // 空库首屏会顶掉整个应用（没有 tabbar）。它的「导入已有备份」只是跳到设置页，
  // 不会弹文件选择框，用它进设置最省事。
  if (!(await page.locator('.tabbar-item', { hasText: '设置' }).count())) {
    await page.getByText('导入已有备份').click();
    await page.waitForTimeout(600);
  }
  await page.locator('.tabbar-item', { hasText: '设置' }).click();
  await page.waitForTimeout(400);
  await page.locator('.settings-nav-title', { hasText: '备份与分享' }).click();
  await page.waitForTimeout(400);
  await page.locator('.settings-hub-title', { hasText: '坚果云备份' }).first().click();
  await page.waitForTimeout(900);
};

console.log('\nU1 有壳：通道一行写「由壳代发」，三档宽度都在');
for (const [w, h] of [[390, 844], [820, 1180], [1440, 900]]) {
  await p.setViewportSize({ width: w, height: h });
  await p.waitForTimeout(300);
  if (!(await p.locator('.sync-channel').count())) await gotoSync(p);
  const txt = (await p.locator('.sync-channel').first().textContent()) || '';
  check(`${w}px：通道一行显示壳代发`, /由壳代发/.test(txt) && /1\.2\.0/.test(txt), txt.slice(0, 120));
  check(`${w}px：提示不用配反代`, /直连坚果云就行/.test(txt), txt.slice(0, 120));
}
await c1.close();

// ---------- B7/B8 + U2：没有壳，退回浏览器 ----------

await resetServer();
console.log('\nB7 没有壳 + 服务端给跨域头（反代）：浏览器直连照常同步');
const { ctx: c2, p: p2 } = await mkPage(false);
await p2.goto(APP, { waitUntil: 'load' });
await waitBoot(p2);
await zero(p2);

const b7 = await p2.evaluate(async (conf) => {
  const dav = await import('/src/core/sync/webdav.ts');
  const native = await (await import('/src/core/sync/nativeHttp.ts')).nativeSupported();
  await dav.ensureDir(conf, 'chunks');
  await dav.putText(conf, 'manifest.json', 'x');
  const list = await dav.list(conf, '');
  return { native, text: await dav.getText(conf, 'manifest.json'), names: list.map((e) => e.name) };
}, cfg('cors'));
const k7 = await counters(p2);
check('判定为不支持走桥', b7.native === false, JSON.stringify(b7));
check('请求由浏览器 fetch 发出（net.request 0 次）', k7.net === 0 && k7.fetch > 0, JSON.stringify(k7));
check('反代路径下读写与列目录都成', b7.text === 'x' && b7.names.includes('manifest.json'), JSON.stringify(b7));

console.log('\nB8 没有壳 + 服务端不给跨域头：报错要说清两条出路');
const b8 = await p2.evaluate(async (conf) => {
  const dav = await import('/src/core/sync/webdav.ts');
  try {
    await dav.ensureDir(conf, '');
    return { msg: '(没报错)' };
  } catch (e) {
    return { msg: String(e.message || e) };
  }
}, cfg('nocors'));
check('报错提到跨域被拦', /跨域|CORS/.test(b8.msg), b8.msg);
check('给出装壳 / 反代两条出路', b8.msg.includes('壳') && b8.msg.includes('反向代理'), b8.msg);

console.log('\nU2 无壳：通道一行写「浏览器直连」');
for (const [w, h] of [[390, 844], [1440, 900]]) {
  await p2.setViewportSize({ width: w, height: h });
  await p2.waitForTimeout(300);
  if (!(await p2.locator('.sync-channel').count())) await gotoSync(p2);
  const txt = (await p2.locator('.sync-channel').first().textContent()) || '';
  check(`${w}px：显示浏览器直连`, /浏览器直连/.test(txt), txt.slice(0, 120));
  check(`${w}px：同时给出装壳这条出路`, /装.*壳|壳里/.test(txt), txt.slice(0, 120));
}
check('高级里的服务地址说明不再假定必须配反代', (await p2.locator('.sync-advanced p').first().textContent()).includes('在带网络代理的壳里这就够了'));
const b11 = await p2.evaluate(async () => {
  const { callTool } = await import('/src/core/tools/registry.ts');
  return await callTool('system.syncChannel');
});
check('无壳时 system.syncChannel 也报 browserFetch', b11.ok === true && b11.data?.channel === 'browserFetch', JSON.stringify(b11.data));
await c2.close();

await browser.close();
server.close();

check('全程没有页面错误', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\n========== 汇总 ==========\n${failures.length ? `失败 ${failures.length} 项：${failures.join(' / ')}` : '全部通过 ✓'}`);
process.exit(failures.length ? 1 : 0);
