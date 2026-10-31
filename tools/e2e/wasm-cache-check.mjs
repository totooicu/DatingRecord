// 验证「数据库引擎只下一次」：连续打开页面多次，统计 sql-wasm.wasm 真正走了几次网络。
//
// 用法：
//   1. npm run build（必须用构建产物，dev 模式下模块未经打包、SW 行为也不同）
//   2. npx vite preview --port 4173
//   3. node tools/e2e/wasm-cache-check.mjs [url]
//
// 依赖：全局 playwright（路径按机器不同：nvm / 系统 node，两处都试一次）
// 已知限制：只统计 wasm 这一个资源；命中 Cache Storage 时浏览器根本不发网络请求，
//          所以用 CDP 的 Network.responseReceived 来数，request 事件数会更少。

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const url = process.argv[2] || 'http://localhost:4173/';

// 系统里没装 playwright 自带的浏览器，统一用 /usr/bin/chromium（CHROMIUM 可覆盖）。
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();

const cdp = await ctx.newCDPSession(p);
await cdp.send('Network.enable');
const hits = [];
// 谁发起的：'preload' 是 index.html 那行 <link rel=preload>，'fetch'/'script' 是页面 JS
const byInitiator = {};
cdp.on('Network.requestWillBeSent', (e) => {
  const u = e.request.url || '';
  if (u.includes('sql-wasm.wasm')) {
    const kind = e.initiator?.type || 'unknown';
    byInitiator[kind] = (byInitiator[kind] || 0) + 1;
  }
});
cdp.on('Network.responseReceived', (e) => {
  const u = e.response.url || '';
  if (u.includes('sql-wasm.wasm')) {
    hits.push({
      fromDiskCache: !!e.response.fromDiskCache,
      fromCache: !!e.response.fromCache,
      status: e.response.status,
    });
  }
});

const boot = async (label) => {
  const t0 = Date.now();
  await p.goto(url, { waitUntil: 'load' });
  // 等首屏启动态消失：人物主页或欢迎页出现即可
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 30000 },
  );
  await p.waitForTimeout(800);
  const txt = await p.evaluate(() => document.body.innerText.slice(0, 40).replace(/\n/g, ' | '));
  console.log(`${label}: ${Date.now() - t0}ms · ${txt}`);
};

await boot('第 1 次打开');
await boot('第 2 次刷新');
await boot('第 3 次刷新');

const info = await p.evaluate(async () => {
  if (typeof caches === 'undefined') return { caches: 'unavailable' };
  const keys = await caches.keys();
  const out = {};
  for (const k of keys) {
    if (!k.startsWith('dr-wasm')) continue;
    const c = await caches.open(k);
    const reqs = await c.keys();
    out[k] = reqs.map((r) => r.url.split('/').pop());
  }
  return { allCaches: keys, wasmCache: out };
});

const sw = await p.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const regs = await navigator.serviceWorker.getRegistrations();
  return {
    count: regs.length,
    active: regs.map((r) => r.active?.state ?? 'none'),
    controlled: !!navigator.serviceWorker.controller,
  };
});

console.log('\n网络层的 sql-wasm.wasm 响应次数：', hits.length);
console.log('发起方统计：', JSON.stringify(byInitiator));
console.log('SW 状态：', JSON.stringify(sw));
console.log(JSON.stringify(hits, null, 2));
console.log('Cache Storage：', JSON.stringify(info, null, 2));
await b.close();
