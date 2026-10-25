// 壳里连续定位（location.* 桥）的端到端回归。
//
// 验证：
//   N1 壳里点「自动打点」→ 不再用页面自己的 GPS 定时器（getCurrentPosition 0 次），
//      配置推到壳（location.setConfig：enabled=true / thresholdM=5），界面提示原生接管
//   N2 原生 location.point 事件 → 点落进当前 .drloc，WGS-84 已换算成 GCJ-02
//   N3 远处的新点会新增一行；原地重复点只刷新时间（阈值去重）
//   N4 刷新后按 dr.autoLocation 接管：问 status、拉 getHistory 合并「挂起期间」的点，
//      再次刷新不重放（游标）
//   N5 改阈值会推给壳（合并抖动后只发一次）；停止会推 enabled=false
//
// 壳用 addInitScript 装的假实现（同 compat-test-e2e 的 K7）：注入标记 +
// location.* 请求/响应 + location.point 事件；原生点与运行态存在 sessionStorage，
// 刷新后才对得上「壳在前台服务里一直记」这件事。
//
// 用法：node tools/e2e/location-native-e2e.mjs [url]

import fs from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const APP = process.argv[2] || 'http://localhost:4173/';

const failures = [];
const check = (label, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
    failures.push(label);
  }
};

const MOCK = `
(() => {
  const mark = () => {
    const de = document.documentElement;
    if (!de) return;
    de.setAttribute('data-gv-bridge-injected', 'true');
    de.setAttribute('data-gv-bridge-stage', 'injected');
    de.setAttribute('data-gv-bridge-native', 'heartbeat@mock');
  };
  mark();
  document.addEventListener('DOMContentLoaded', mark);

  // 壳里页面不该自己轮询 GPS：桩掉，只计数
  window.__geoCalls = 0;
  try {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: () => { window.__geoCalls += 1; },
        watchPosition: () => { window.__geoCalls += 1; return 1; },
        clearWatch: () => {}
      }
    });
  } catch (e) {}

  const NATIVE = (window.__nativeState = { tracking: false, points: [] });
  try {
    const saved = sessionStorage.getItem('__mockNative');
    if (saved) Object.assign(NATIVE, JSON.parse(saved));
  } catch (e) {}
  const save = () => {
    try {
      sessionStorage.setItem('__mockNative', JSON.stringify({ tracking: NATIVE.tracking, points: NATIVE.points }));
    } catch (e) {}
  };

  // 原生服务记了点：只进壳的历史（模拟页面挂起，收不到事件）
  window.__recordOnly = (p) => { NATIVE.points.push(p); save(); };
  // 原生服务实时推事件（页面在前台）
  window.__emitPoint = (p) => {
    NATIVE.points.push(p);
    save();
    window.postMessage({ type: 'gv-bridge-event', event: 'location.point', data: p }, '*');
  };

  const reply = (id, ok, result, error) =>
    window.postMessage({ type: 'gv-bridge-response', id, ok, result, error }, '*');

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.type !== 'gv-bridge-request') return;
    if (!window.__calls) window.__calls = [];
    window.__calls.push({ action: m.action, params: m.params });
    switch (m.action) {
      case 'ping':
        return reply(m.id, true, { pong: true, shell: 'mock' });
      case 'location.setConfig':
        NATIVE.tracking = m.params.enabled === true;
        save();
        return reply(m.id, true, Object.assign({}, m.params, { tracking: NATIVE.tracking }));
      case 'location.start':
        NATIVE.tracking = true; save();
        return reply(m.id, true, { tracking: true });
      case 'location.stop':
        NATIVE.tracking = false; save();
        return reply(m.id, true, { tracking: false });
      case 'location.status':
        return reply(m.id, true, { tracking: NATIVE.tracking, points: NATIVE.points.length });
      case 'location.getHistory':
        return reply(m.id, true, { points: NATIVE.points, rev: NATIVE.points.length });
      default:
        return reply(m.id, false, null, 'mock 不认这个 action：' + m.action);
    }
  });
})();
`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['geolocation'],
  geolocation: { latitude: 31.2304, longitude: 121.4737 },
});
await ctx.addInitScript(MOCK);
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
p.on('dialog', (d) => d.accept());

const waitBoot = async () => {
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );
};

const calls = () => p.evaluate(() => window.__calls ?? []);
const geoCalls = () => p.evaluate(() => window.__geoCalls ?? -1);
const config = () =>
  p.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('dr.autoLocation') ?? 'null');
    } catch {
      return null;
    }
  });
const rowCount = () => p.locator('.music-list li').count();

/** 刷新后页面回到人物 tab，得重新进 设置 → 功能面板 → 定位 → 记录 */
const openLocationRecords = async () => {
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.waitForTimeout(500);
  await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
  await p.waitForTimeout(500);
  await p.locator('.settings-hub-title', { hasText: '定位' }).first().click();
  await p.waitForTimeout(1500);
  await p.getByRole('tab', { name: '记录' }).click();
  await p.waitForTimeout(600);
};

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(3000);
}

// ---- 进定位面板，建文件 ----
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(500);
await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
await p.waitForTimeout(500);
await p.locator('.settings-hub-title', { hasText: '定位' }).first().click();
await p.waitForTimeout(1500);
await p.getByRole('tab', { name: '文件' }).click();
await p.waitForTimeout(500);
await p.locator('input[placeholder*="新文件名"]').fill('壳连续定位');
await p.getByRole('button', { name: '新建', exact: true }).click();
await p.waitForTimeout(1200);

console.log('\nN1 壳里开始打点：交给原生服务，页面不再自己轮询');
await p.getByRole('button', { name: '▶ 自动打点' }).click();
await p.waitForTimeout(1000);
const startCalls = await calls();
const setCfg = startCalls.filter((c) => c.action === 'location.setConfig').pop();
check('推了 location.setConfig', !!setCfg, JSON.stringify(startCalls.map((c) => c.action)));
check('配置里 enabled=true / thresholdM=5', setCfg?.params?.enabled === true && setCfg?.params?.thresholdM === 5, JSON.stringify(setCfg?.params));
check('页面自己的 GPS 一次都没取（不再用定时器）', (await geoCalls()) === 0, `geoCalls=${await geoCalls()}`);
check('面板出现「原生服务接管」提示', (await p.locator('.loc-native-hint').count()) === 1);
check('head 出现服务图标', (await p.locator('.page-head-right .hs-svc').count()) >= 1);
const saved = await config();
check('dr.autoLocation 存档是壳读的那一份', saved?.enabled === true && saved?.thresholdM === 5, JSON.stringify(saved));

console.log('\nN2 原生 location.point → 落进 .drloc（WGS-84 已换算 GCJ-02）');
await p.evaluate(() => window.__emitPoint({ ts: Date.now(), lat: 31.2304, lng: 121.4737, accuracy: 8 }));
await p.waitForTimeout(800);
check('列表多了一行', (await rowCount()) === 1, `rows=${await rowCount()}`);
const firstRow = (await p.locator('.music-list li').first().innerText()).replace(/\n/g, ' ');
check('坐标按 GCJ-02 显示（上海 31.2304,121.4737 → 31.228458,121.475868）', firstRow.includes('31.228458,121.475868'), firstRow);

console.log('\nN3 远处新增、原地重复只刷新时间');
await p.evaluate(() => window.__emitPoint({ ts: Date.now() + 1000, lat: 31.24, lng: 121.49, accuracy: 10 }));
await p.waitForTimeout(800);
check('远处的新点新增一行', (await rowCount()) === 2, `rows=${await rowCount()}`);
await p.evaluate(() => window.__emitPoint({ ts: Date.now() + 2000, lat: 31.24, lng: 121.49, accuracy: 12 }));
await p.waitForTimeout(800);
check('原地重复点不新增（阈值去重）', (await rowCount()) === 2, `rows=${await rowCount()}`);

console.log('\nN4 刷新后接管：拉历史补点、不重放');
// 模拟页面挂起期间原生又记了一个点（只进壳的历史，页面收不到事件）
await p.evaluate(() => window.__recordOnly({ ts: Date.now() + 3000, lat: 30.5, lng: 114.3, accuracy: 15 }));
await p.reload({ waitUntil: 'load' });
await waitBoot();
await p.waitForTimeout(2500);
await openLocationRecords();
check('刷新后仍是同一份文件', (await p.locator('.loc-card-head', { hasText: '壳连续定位' }).first().innerText()).includes('壳连续定位'));
const resumedCalls = await calls();
check('接管时问了 location.status', resumedCalls.some((c) => c.action === 'location.status'), JSON.stringify(resumedCalls.map((c) => c.action)));
check('接管时拉了 location.getHistory', resumedCalls.some((c) => c.action === 'location.getHistory'), JSON.stringify(resumedCalls.map((c) => c.action)));
check('挂起期间的点补进来了', (await rowCount()) === 3, `rows=${await rowCount()}`);
check('刷新后页面还是不用自己的 GPS', (await geoCalls()) === 0, `geoCalls=${await geoCalls()}`);

await p.reload({ waitUntil: 'load' });
await waitBoot();
await p.waitForTimeout(2000);
await openLocationRecords();
check('再刷新一次不重放历史（游标生效）', (await rowCount()) === 3, `rows=${await rowCount()}`);

console.log('\nN5 改阈值 / 停止都会同步给壳');
const thresholdInput = p.locator('.loc-row input.loc-num').first();
await thresholdInput.fill('20');
await p.waitForTimeout(1000);
const cfgAfter = (await calls()).filter((c) => c.action === 'location.setConfig').pop();
check('阈值推给壳（enabled 保持 true）', cfgAfter?.params?.thresholdM === 20 && cfgAfter?.params?.enabled === true, JSON.stringify(cfgAfter?.params));
const savedAfter = await config();
check('存档里的阈值也更新了', savedAfter?.thresholdM === 20, JSON.stringify(savedAfter));

await p.getByRole('button', { name: '⏹ 停止自动打点' }).click();
await p.waitForTimeout(900);
const stopCfg = (await calls()).filter((c) => c.action === 'location.setConfig').pop();
check('停止推 enabled=false', stopCfg?.params?.enabled === false, JSON.stringify(stopCfg?.params));
check('提示消失', (await p.locator('.loc-native-hint').count()) === 0);
const stopSaved = await config();
check('存档里 enabled=false', stopSaved?.enabled === false, JSON.stringify(stopSaved));

await ctx.close();
await browser.close();

console.log(`\n========== 汇总 ==========\n${failures.length ? `失败 ${failures.length} 项：${failures.join(' / ')}` : '全部通过 ✓'}`);
process.exit(failures.length ? 1 : 0);
