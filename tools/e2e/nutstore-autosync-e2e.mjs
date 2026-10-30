// 坚果云「自动（自启动）同步服务」的端到端回归。
//
// 这个服务的全部风险都不在「能不能传」，而在**什么时候**传、会不会传不停：
//   T1  没配置时一切安静：服务列出来了但没起，一个请求都不发
//   T2  账号没填就想起 → 起不来，并且留下一句人看得懂的原因
//   T3  勾上「自动同步」→ 不点任何按钮，开软件那一趟真的把库传上去了
//   T4  本机写一笔 → 安静一会儿自己补一趟（reason = change）
//   T5  **不会自己喂自己**：传完静置十几个节拍，云端零新请求（同步引擎自己的
//       写入要是被算成「本机有新东西」，这里就会一趟接一趟打坚果云）
//   T6  手动同步正在传时，自动那一拍跳过，不并发写同一个 baseline / 清单
//   T7  服务端报错 → 记下失败、退避窗口内不猛打、恢复后自己重试成功且不丢改动
//   T8  定时间隔到点就跑（即使本机没改动）；设置页选间隔不用点「保存设置」
//   T9  两条工具（铁律四）：system.syncAuto 可读不含密码、system.setAutoSync 可开关并校验入参
//   T10 关掉之后：再写东西也不发请求，改动就欠着
//   T11 自启动：刷新页面（= 重开软件）后服务自己起来，不用点任何东西，欠的那笔也补上了
//
// 假坚果云起在本进程里（临时端口，带跨域头），云端状态直接用进程内的 Map 查，
// 请求流水用 log 数组数——「有没有多打一次」是可数的，不靠界面自己说。
// 额外两个开关：fail.manifest（PUT manifest.json 回 503，测失败退避）、
// slow.manifestMs（把清单写入拖慢，制造「正在传」的可观察窗口）。
// 「壳」用 addInitScript 装：接 net.capabilities / net.request，用**原始 fetch** 代发
// （页面的 window.fetch 包了一层计数，所以「有没有走桥」是可证的）。
//
// 用法：node tools/e2e/nutstore-autosync-e2e.mjs [dev-url]   默认 http://localhost:5174/
// 必须 Vite dev 服务（要动态 import 源码模块），不能用 preview。

import fs from 'node:fs';
import http from 'node:http';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 假坚果云 WebDAV ----------

const USER = 'tester@example.com';
const PASS = 'app-pass-123';
const BASIC = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
const ROOT = 'DatingRecord';
const NS = 'dav';
const PREFIX = `/${NS}/${ROOT}/`;
const MANIFEST = `${PREFIX}manifest.json`;

const files = new Map(); // '/dav/路径' -> { dir, size, body, ct }
const log = []; // { method, path, len, depth, auth }
/** PUT manifest.json 回 503：测「失败那趟不丢改动、退避、恢复后重试」 */
const fail = { manifest: false };
/** PUT manifest.json 拖慢（毫秒）：制造「正在传」的可观察窗口，本地回环太快看不到 */
const slow = { manifestMs: 0 };

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
  req.on('end', async () => {
    const body = Buffer.concat(raw);
    const m = (req.method || '').toUpperCase();
    log.push({ method: m, path: pathname, len: body.length, depth: req.headers.depth ?? null });

    if (m === 'OPTIONS') {
      res.writeHead(204, h).end('');
      return;
    }
    const isManifest = m === 'PUT' && dirKey(pathname) === MANIFEST;
    if (isManifest && slow.manifestMs) await sleep(slow.manifestMs);
    if (isManifest && fail.manifest) {
      res.writeHead(503, h).end('假坚果云这会儿抽了');
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
      // 真实 WebDAV 的规矩：父集合不存在时 PUT 回 409（RFC 4918 §9.7.1），假服务端必须照做
      const parent = k.slice(0, k.lastIndexOf('/'));
      const pv = parent ? files.get(parent) : null;
      if (!pv || !pv.dir) {
        res.writeHead(409, h).end('父目录不存在');
        return;
      }
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

const remoteText = (p) => {
  const v = files.get(`${PREFIX}${p}`);
  return v && !v.dir ? v.body.toString('utf8') : null;
};
const manifestPuts = (from) => log.slice(from).filter((r) => r.method === 'PUT' && r.path === MANIFEST).length;
const anyReq = (from) => log.length - from;

console.log(`假坚果云 WebDAV：http://127.0.0.1:${PORT}/${NS}`);

// ---------- 假壳：接 net.*，用原始 fetch 代发 ----------

const SHELL = `
(() => {
  const rawFetch = window.fetch.bind(window);
  window.__fetchCount = 0;
  window.fetch = (...a) => { window.__fetchCount += 1; return rawFetch(...a); };

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

// ---------- 页面里那几个模块就是被测对象本身（同一个模块实例，不是替身） ----------
//
// 坑（踩过一次，值得写在文件头）：Vite dev 会给「服务起来之后改过的文件」的 import 地址
// 加上 ?t=<mtime>。直接 import 裸路径 '/src/core/sync/auto.ts' 拿到的是**第二个实例**——
// 里面的定时器、趟数、水位线全是零，看着像服务根本没跑，把一整条回归带沟里去。
// 所以统一走 window.__mod()：先从 performance 记录里找出应用真正加载过的那个 URL 再 import。
const status = () =>
  p.evaluate(async () => (await window.__mod('/src/core/sync/auto.ts')).autoStatus());
const inject = (tuning) =>
  p.evaluate(async ([t]) => (await window.__mod('/src/core/sync/auto.ts')).startAutoSync(t), [tuning]);
const rawStart = () =>
  p.evaluate(async () => {
    const m = await window.__mod('/src/core/sync/auto.ts');
    return { started: m.startAutoSync(), st: m.autoStatus() };
  });
const svcNote = () =>
  p.evaluate(async () => {
    // 状态说明由服务写在服务表里，界面上那句「为什么没起来」就是这么来的
    const { getServices } = await window.__mod('/src/core/runtime/store.ts');
    const s = getServices().find((x) => x.id === 'nutstore-sync');
    return s ? { running: s.running, autostart: s.autostart, note: s.note || '', detail: s.detail || '' } : null;
  });
const syncing = () =>
  p.evaluate(async () => (await window.__mod('/src/core/sync/engine.ts')).isSyncing());
const tool = (name, args) =>
  p.evaluate(async ([n, a]) => {
    const { callTool } = await window.__mod('/src/core/tools/registry.ts');
    return await callTool(n, a);
  }, [name, args]);
const addPerson = (name) =>
  p.evaluate(async (n) => {
    const { callTool } = await window.__mod('/src/core/tools/registry.ts');
    const r = await callTool('person.create', { displayName: n });
    if (!r.ok) throw new Error('建人物失败：' + r.error);
    return true;
  }, name);
const goto = async (t, loc) => {
  await p.evaluate(async (x) => {
    const { navigate } = await window.__mod('/src/core/runtime/nav.ts');
    navigate(x);
  }, t);
  // 用带文案的按钮定位：list 页在设置页背后仍然挂着，button.btn-primary 会先命中那个「＋ 记一件事」
  await loc.first().waitFor({ timeout: 15000 });
  await p.waitForTimeout(300);
};

/** 等某个条件成立（返回最后状态，不抛错：回归要能报「哪条不满足」而不是整个挂掉） */
async function waitFor(pred, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const st = await status();
    if (st && pred(st)) return st;
    if (Date.now() - t0 > ms) {
      console.log(`      （等不到${what}；最后状态 ${JSON.stringify(st).slice(0, 220)}）`);
      return null;
    }
    await sleep(50);
  }
}

/**
 * 第一次进坚果云设置页老老实实点 tabbar（顺手证明这条路点得通）；
 * 之后一律走应用自己的导航（服务页「打开」按钮那条路）：
 * 从整屏页（服务页）往回点很容易撞到「按钮在 DOM 里但被藏起来」的超时，
 * 而那不是被测行为。
 */
const gotoSyncByClick = async () => {
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
/** 状态里的「这一趟已经跑完了」：趟数与理由在开始时写，lastOkAt 在成功结束时写 */
const settled = (s) => !!s && s.lastPassAt > 0 && s.lastOkAt >= s.lastPassAt;
const gotoSync = () => goto({ type: 'settings', key: 'sync' }, p.locator('button.btn', { hasText: '保存设置' }));
const gotoServices = () => goto({ type: 'page', key: 'services' }, p.locator('.svc-list'));
const syncRowText = async () => {
  const n = await p.locator('.svc-row', { hasText: '坚果云自动同步' }).count();
  return n ? await p.locator('.svc-row', { hasText: '坚果云自动同步' }).first().innerText() : '';
};

// 装上「按应用自己用过的那个 URL 取模块」的工具（见文件头那段注释）
const installMod = () =>
  p.evaluate(() => {
    try {
      performance.setResourceTimingBufferSize(50000);
    } catch {
      /* 有些浏览器不让调，那就只能指望记录没被截断 */
    }
    const cache = {};
    window.__mod = async (path) => {
      if (cache[path]) return cache[path];
      const hit = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .find((n) => {
          try {
            return new URL(n, location.href).pathname === path;
          } catch {
            return false;
          }
        });
      const m = await import(hit || path);
      cache[path] = m;
      return m;
    };
  });

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
await installMod();

// ---------- T1 新库刚打开：一切安静 ----------

console.log('\nT0 回归拿的是应用那一份模块，不是第二个实例');
const sameInstance = await p.evaluate(async () => {
  const direct = await window.__mod('/src/core/sync/auto.ts');
  const barrel = await window.__mod('/src/core/sync/index.ts');
  return direct.autoStatus === barrel.autoStatus && direct.AUTO_SERVICE_ID === barrel.AUTO_SERVICE_ID;
});
check('harness 的 import 与应用静态 import 是同一份模块（状态才是同一份）', sameInstance === true, String(sameInstance));

console.log('\nT1 新库里默认全关，一个请求都不发');
const t1 = await status();
check('自动同步是关着的（enabled=false）', t1.enabled === false && t1.running === false, JSON.stringify(t1));
let svc = await svcNote();
check('服务在列表里但没起（自启动也没勾）', !!svc && svc.running === false && svc.autostart === false, JSON.stringify(svc));
check('服务页能看到「坚果云自动同步」，状态是停止 + 未开启', !!svc && svc.running === false && svc.autostart === false && /未开启自动同步/.test(svc.note), JSON.stringify(svc));
check('账号都没填，所以配置状态是 false', t1.configured === false, JSON.stringify(t1));
check('云端一个请求都没收到', log.length === 0, JSON.stringify(log.slice(0, 5)));

// ---------- T2 账号没填硬要起服务 ----------

console.log('\nT2 账号没填起不来，而且要说明为什么');
const t2 = await rawStart();
check('startAutoSync() 返回 false（不假装起来了）', t2.started === false, JSON.stringify(t2));
svc = await svcNote();
check('留下人看得懂的一句：还没填账号', !!svc && /还没填坚果云账号/.test(svc.note), JSON.stringify(svc));
check('仍然零请求', log.length === 0, JSON.stringify(log.slice(0, 5)));

// ---------- 配好账号（走界面），先不勾自动同步 ----------

await gotoSyncByClick();
const autoBox = p.getByRole('checkbox', { name: /自动同步：开软件自启动/ });
check('设置页有「自动同步」这一项', (await autoBox.count()) === 1, `${await autoBox.count()} 个`);
check('默认没勾（新库不该一装上就后台联网）', !(await autoBox.isChecked()));
await p.getByLabel(/坚果云账号/).fill(USER);
await p.getByLabel(/应用密码/).fill(PASS);
await p.locator('.sync-advanced summary').click();
await p.waitForTimeout(300);
await p.getByLabel(/WebDAV 地址/).fill(CFG.base);
await p.locator('.sync-advanced summary').click();
await p.waitForTimeout(300);
await p.locator('button.btn', { hasText: '保存设置' }).click();
await p.waitForTimeout(300);
const t2b = await status();
check('只保存设置不勾自动同步 → 服务不起、不联网', t2b.running === false && log.length === 0, JSON.stringify(t2b));

// ---------- T3 勾上：开软件那一趟立刻补上，全程没点过「立即同步」 ----------

console.log('\nT3 勾上自动同步：不点任何按钮就传上去了');
const f0 = await fetchCount();
await autoBox.click();
const t3 = await waitFor((s) => s.lastOkAt > 0 || s.lastError, 30000, '开软件那一趟跑完');
check('云端出现了清单（没点「立即同步」，是它自己传的）', !!remoteText('manifest.json'), JSON.stringify(log.slice(0, 3)));
check('那一趟的理由是「开软件」', t3 && t3.lastReason === 'boot', JSON.stringify(t3));
check('结果是上传本机改动', t3 && t3.lastAction === 'upload' && t3.lastError === null, JSON.stringify(t3));
check('服务在跑，且自启动同步勾上了（服务页那边也一致）', t3 && t3.running === true && t3.enabled === true, JSON.stringify(t3));
svc = await svcNote();
check('服务表里 running=true 且没有遗留的报错说明', !!svc && svc.running === true && svc.autostart === true && svc.note === '', JSON.stringify(svc));
check('传完本机不再欠着改动', t3 && t3.pendingWrites === 0, JSON.stringify(t3));
check('传输全程走壳桥，没碰页面 window.fetch', (await fetchCount()) === f0, `fetch ${await fetchCount()} vs ${f0}`);
const uiLine = await p.locator('.sync-auto-state').innerText().catch(() => '');
check('设置页那行状态写着运行中（用户能看见它的节拍）', /运行中/.test(uiLine), uiLine.slice(0, 120));

// 真实节拍（15 秒一眼 / 安静一分钟）在回归里等不起：换小值，只换参数不再补 boot 趟
await inject({ tickMs: 100, quietMs: 300, retryMs: 1500, minuteMs: 200 });

// ---------- T4 本机写一笔 → 补一趟 ----------

console.log('\nT4 本机改动自己会传上去');
await sleep(2500); // 上一趟与这一趟之间留空，免得计数搅在一起
const m4 = log.length;
const p4 = (t3 || { passes: 0 }).passes;
const ok4 = (t3 || { lastOkAt: 0 }).lastOkAt;
await addPerson('自动同步测试甲');
const t4 = await waitFor((s) => s.passes > p4 && s.lastOkAt > ok4 && s.lastReason === 'change', 15000, '改动触发的那一趟跑完');
check('本机写了一笔之后自动跑了一趟', !!t4 && t4.passes > p4, JSON.stringify(t4));
check('理由是「本机改动」（不是等到定时才传）', !!t4 && t4.lastReason === 'change', JSON.stringify(t4));
check('这一趟真往云端写了清单', manifestPuts(m4) >= 1, JSON.stringify(log.slice(m4, m4 + 6)));
check('传完 pending 归零', !!t4 && t4.pendingWrites === 0, JSON.stringify(t4));

// ---------- T5 不会自己喂自己 ----------

console.log('\nT5 关键：同步自己的写入不算「本机有新东西」，不会一趟接一趟');
const m5 = log.length;
const p5 = (t4 || { passes: 0 }).passes;
await sleep(2500); // 25 拍、8 个安静窗口：真在自喂的话这里早就刷屏了
const t5 = await status();
check('静置期间云端零新请求', anyReq(m5) === 0, JSON.stringify(log.slice(m5, m5 + 8)));
check('静置期间趟数没有增长', t5.passes === p5, `${t5.passes} vs ${p5}`);
check('本机仍然不欠改动', t5.pendingWrites === 0, JSON.stringify(t5).slice(0, 200));

// ---------- T6 手动同步正在传时，自动那一拍跳过 ----------

console.log('\nT6 手动同步在跑 → 自动这一拍跳过（不并发写同一份 baseline）');
await addPerson('自动同步测试乙');
slow.manifestMs = 1400;
await p.evaluate(async (conf) => {
  const m = await window.__mod('/src/core/sync/engine.ts');
  window.__manual = m.syncNow(conf, { attachments: false });
}, CFG);
await sleep(200);
const busy = await syncing();
const p6 = (await status()).passes;
await sleep(1000); // 安静窗口 300ms 早就过了，若不看 isSyncing 这里必然又起一趟
const mid = await status();
const manual = await p.evaluate(async () => await window.__manual);
slow.manifestMs = 0;
const t6 = await status();
check('手动同步确实在传（isSyncing 为真）', busy === true, String(busy));
check('自动服务没有插进来并行跑（趟数没变）', mid.passes === p6, `${mid.passes} vs ${p6}`);
check('手动那一趟成功', !!manual && !!manual.at, JSON.stringify(manual).slice(0, 160));
check('手动成功后本机改动也算传完了', settled(t6) && t6.pendingWrites === 0, JSON.stringify(t6).slice(0, 220));
check('这一段的写入仍然走桥', (await fetchCount()) === f0, `fetch ${await fetchCount()} vs ${f0}`);

// ---------- T7 失败退避 ----------

console.log('\nT7 服务端报错：记下失败、退避不猛打、恢复后自己补上');
fail.manifest = true;
const m7 = log.length;
const p7 = (await status()).passes;
await addPerson('自动同步测试丙');
const t7 = await waitFor((s) => s.passes > p7 && s.lastError, 15000, '失败那一趟');
check('失败被记下来了（不是静悄悄跳过）', !!t7 && !!t7.lastError, JSON.stringify(t7));
check('失败那趟本机改动仍算欠着（不会把没传的当成传了）', !!t7 && t7.pendingWrites > 0, JSON.stringify(t7));
check('排上了退避时间', !!t7 && t7.nextRetryAt > Date.now() - 1500, JSON.stringify(t7));
const m7b = log.length;
await sleep(900); // 安静窗口 300ms + 每 100ms 一拍：没有退避的话这里至少又打三次
const hammer = anyReq(m7b);
check('退避窗口内没有对着报错的服务端猛打', hammer === 0, `又发了 ${hammer} 个请求`);
svc = await svcNote();
check('服务页那行看得到失败原因', !!svc && /自动同步失败/.test(svc.note), JSON.stringify(svc));
fail.manifest = false;
const ok7 = (t7 || { lastOkAt: 0 }).lastOkAt;
const t7c = await waitFor((s) => s.lastOkAt > ok7 && !s.lastError && s.pendingWrites === 0, 15000, '退避后的重试');
check('退避到点自己重试并成功', !!t7c, JSON.stringify(t7c));
check('重试把欠着的那笔传上去了（改动没丢）', !!t7c && manifestPuts(m7) >= 2, JSON.stringify(log.slice(m7).filter((r) => r.method === 'PUT').length));
const snapName = remoteText('manifest.json');
check('云端清单是最新那一趟写的', !!snapName && JSON.parse(snapName).deviceId, String(!!snapName));

// ---------- T8 定时间隔 ----------

console.log('\nT8 定时：到点就跑，不等本机改动');
// 关掉「有改动就同步」，只留定时——证明定时器这条路本身在工作
const changeBox = p.getByRole('checkbox', { name: /本机有改动就同步/ });
check('勾上自动同步后才露出这两个节拍设置', (await changeBox.count()) === 1, `${await changeBox.count()} 个`);
const sel = p.locator('.field', { hasText: '定时间隔' }).locator('select');
check('下拉里是 0/5/10/15/30/60 六个档', (await sel.locator('option').count()) === 6, `${await sel.locator('option').count()} 个`);
await sel.selectOption('5');
await p.waitForTimeout(300);
const t8a = await status();
check('选完间隔不用点「保存设置」就落库了', t8a.everyMin === 5, JSON.stringify(t8a));
await changeBox.click();
await p.waitForTimeout(300);
const t8b = await status();
check('关掉「有改动就同步」立刻生效（同样不用点保存）', t8b.onChanged === false, JSON.stringify(t8b));
// 每 5 分钟 = 5 × minuteMs(200ms) = 1 秒一趟
const p8 = t8b.passes;
const t8 = await waitFor((s) => s.passes >= p8 + 2 && s.lastReason === 'timer' && settled(s), 15000, '两趟定时同步跑完');
check('定时到点自己跑，而且连着跑了两趟以上', !!t8 && t8.passes >= p8 + 2, JSON.stringify(t8));
check('理由写的是「定时」（不是改动触发）', !!t8 && t8.lastReason === 'timer', JSON.stringify(t8));
check('定时那趟不因为本机没改就骗说有上传（noop 也算跑过）', !!t8 && (t8.lastAction === 'noop' || t8.lastAction === 'upload'), JSON.stringify(t8));

// ---------- T9 工具（铁律四）----------

console.log('\nT9 两条工具');
const g1 = await tool('system.syncAuto');
check('system.syncAuto 可读', g1.ok === true, JSON.stringify(g1).slice(0, 200));
check('报出开关 / 节拍 / 欠着的改动数', g1.ok && typeof g1.data.enabled === 'boolean' && g1.data.everyMin === 5 && typeof g1.data.pendingWrites === 'number', JSON.stringify(g1.data).slice(0, 240));
check('不含密码', !JSON.stringify(g1).includes(PASS), JSON.stringify(g1).slice(0, 120));
check('带一句人（和模型）能照着做的 hint', !!g1.data && /在跑|关着|起不来|失败/.test(g1.data.hint), JSON.stringify(g1.data.hint));
const g2 = await tool('system.setAutoSync', { everyMin: 7 });
check('非法间隔被拒（不会变成后台一个说不清的定时器）', g2.ok === false && /只接受/.test(String(g2.error)), JSON.stringify(g2).slice(0, 200));
const g3 = await tool('system.setAutoSync', { everyMin: 15, onChanged: true });
check('只改节拍时不动总开关，也不用重启服务', g3.ok === true && g3.data.enabled === true && g3.data.running === true && g3.data.everyMin === 15 && g3.data.onChanged === true, JSON.stringify(g3.data));
const g4 = await tool('system.setAutoSync');
check('一个参数都不给时报错而不是「随便改改」', g4.ok === false, JSON.stringify(g4).slice(0, 160));
const g5 = await tool('system.setAutoSync', { enabled: false });
check('system.setAutoSync(enabled=false) 能停', g5.ok === true && g5.data.running === false && g5.data.enabled === false, JSON.stringify(g5.data));
await gotoServices();
const rowStop = await syncRowText();
check('服务页那一行跟着变「已停止」', /已停止/.test(rowStop), rowStop.replace(/\s+/g, ' ').slice(0, 120));
await gotoSync();

// ---------- T10 关掉之后：写东西也不再联网 ----------

console.log('\nT10 关掉之后真的不传了');
// 刚才那一串工具调用可能刚好赶上定时器有一趟在飞，等它落地再数请求
for (let i = 0; i < 100 && (await syncing()); i += 1) await sleep(100);
const m10 = log.length;
await addPerson('关掉之后写的');
await sleep(1500);
const t10 = await status();
check('自动关着时本机改动不会自己传（欠着是应该的）', anyReq(m10) === 0 && t10.pendingWrites > 0 && t10.running === false, `${anyReq(m10)} 个请求 · ${JSON.stringify(t10).slice(0, 160)}`);

// ---------- T11 自启动：刷新页面 = 重开软件 ----------

console.log('\nT11 自启动：刷新后自己起来，不用点任何东西');
await autoBox.click(); // 界面上的勾还留着（disabled 时才变），点一下就重新开启
await p.waitForTimeout(1200);
await p.reload({ waitUntil: 'load' });
await waitBoot();
await installMod(); // 刷新把 window 上的东西清了，取模块的工具要重新装
const t11 = await waitFor((s) => s.running && s.lastOkAt > 0, 30000, '刷新后自动跑的第一趟');
check('重开软件后服务自己起来了', !!t11 && t11.running === true, JSON.stringify(t11));
check('起来就先补一趟「开软件」同步（这次是 noop：上一趟已传过）', !!t11 && t11.lastReason === 'boot' && t11.passes === 1, JSON.stringify(t11));
check('库里存的开关被认出来了（enabled=true）', !!t11 && t11.enabled === true, JSON.stringify(t11));
svc = await svcNote();
check('自启动存档跟着库写对了（服务页那个勾和库里的开关是同一个真相）', !!svc && svc.autostart === true, JSON.stringify(svc));
await gotoServices();
const rowRun = await syncRowText();
check('服务页那一行是运行中，还带着这一趟的结果', /运行中/.test(rowRun) && /开软件/.test(rowRun), rowRun.replace(/\s+/g, ' ').slice(0, 140));
// head 的服务图标只在应用主界面里（整屏页没有 head），退回设置页再数
await gotoSync();
const glyphs = await p.locator('.hs-icon.hs-svc.running svg').count();
check('head 上有运行中的服务图标（这库里音乐没播，那只能是自动同步）', glyphs >= 1, `${glyphs} 个`);
const uiAfter = await p.getByRole('checkbox', { name: /自动同步：开软件自启动/ }).isChecked();
check('刷新后设置页的开关仍是勾着的（设置存在库里，不靠 localStorage）', uiAfter === true, String(uiAfter));
check('关掉期间欠着的那笔改动，重开后被传掉了', (await status()).pendingWrites === 0, JSON.stringify(await status()));

// ---------- 收尾 ----------

await ctx.close();
await browser.close();
server.close();

check('全程没有页面错误', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\n========== 汇总 ==========\n${failures.length ? `失败 ${failures.length} 项：${failures.join(' / ')}` : '全部通过 ✓'}`);
process.exit(failures.length ? 1 : 0);
