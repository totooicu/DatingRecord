// 定位取点的「监听缓存」e2e：秒级采样不该被一次定位的耗时拖慢。
//
// 背景：真机上 getCurrentPosition 冷启动常要 5～8 秒，1 秒级的自动打点会变成
// 「每 8 秒一个点」。现在页面里常驻 watchPosition，打点只读最近一次定位。
//
// 验证：
//   G1 定位一次要 3 秒时，秒级自动打点仍是约 1 秒一个（首个点不等定位）
//   G2 监听缓存有效时，「记录位置」不需要再等一次完整定位
//   G3 停止打点 + 离开面板后关掉监听（clearWatch），不留 GPS 常驻
//
// 依赖：`pnpm build` 后用静态服务器起 dist，再装 playwright。
// 用法：node tools/e2e/location-fix-cache-e2e.mjs [url]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const APP = process.argv[2] || 'http://localhost:4173/';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-fixcache-'));
/** 模拟真机：现取一次定位要这么久 */
const SLOW_MS = 3000;

const failures = [];
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures.push(label);
};

const trackFile = path.join(TMP, '取点.drloc');
fs.writeFileSync(
  trackFile,
  JSON.stringify({
    format: 'dr.location',
    version: 1,
    name: '取点',
    offset: { lat: 0, lng: 0 },
    points: [],
    createdAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:00:00.000Z',
  }),
);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
// 桩掉 geolocation：现取慢（SLOW_MS），监听每秒推一次
await ctx.addInitScript((slow) => {
  let lat = 30.27;
  const pick = (cb) => {
    lat += 0.0001;
    cb({ coords: { latitude: lat, longitude: 120.15, accuracy: 6 }, timestamp: Date.now() });
  };
  window.__geo = { ones: 0, watches: 0, clears: 0 };
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok) => {
        window.__geo.ones += 1;
        setTimeout(() => pick(ok), slow);
      },
      watchPosition: (ok) => {
        window.__geo.watches += 1;
        return setInterval(() => pick(ok), 1000);
      },
      clearWatch: (id) => {
        window.__geo.clears += 1;
        clearInterval(id);
      },
    },
  });
}, SLOW_MS);

const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

const waitBoot = () =>
  p.waitForFunction(() => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none', null, { timeout: 90000 });

const toLocation = async () => {
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.waitForTimeout(400);
  for (let i = 0; i < 4; i += 1) {
    if (await p.locator('.settings-nav-title').first().isVisible().catch(() => false)) break;
    const back = p.locator('.back-btn').first();
    if (!(await back.count())) break;
    await back.click();
    await p.waitForTimeout(300);
  }
  await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: '定位' }).first().click();
  await p.waitForTimeout(1200);
};
const tab = (name) => p.locator('.loc-panel .aichat-tab', { hasText: name });
const pts = () =>
  p.evaluate(() => Number((/(\d+) 个点/.exec(document.querySelector('.loc-panel')?.innerText || '') || [0, 0])[1]));

console.log('\n=== 定位取点：监听缓存 端到端 ===');

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(2500);
}

await toLocation();
await tab('文件').click();
await p.waitForTimeout(400);
await p.getByRole('button', { name: '导入 .drloc / 旧 CSV' }).click();
await p.locator('input[accept*="drloc"]').setInputFiles(trackFile);
await p.waitForTimeout(1200);
await tab('记录').click();
await p.waitForTimeout(400);
await p.locator('.loc-row input.loc-num').first().fill('0');
await p.locator('.loc-select').first().selectOption('fixed');
await p.waitForTimeout(300);

console.log('\nG1 秒级自动打点不被定位耗时拖慢');
const t0 = Date.now();
const marks = [];
let last = await pts();
await p.getByRole('button', { name: '▶ 自动打点' }).click();
while (Date.now() - t0 < 8000) {
  await p.waitForTimeout(150);
  const n = await pts();
  if (n !== last) {
    marks.push(Date.now() - t0);
    last = n;
  }
}
const firstAt = marks[0] ?? Infinity;
const gaps = marks.slice(1).map((ms, i) => ms - marks[i]);
const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : Infinity;
check('首个点不等一次完整定位', firstAt < SLOW_MS, `第一个点 ${firstAt}ms（现取要 ${SLOW_MS}ms）`);
check('8 秒内至少 6 个点', marks.length >= 6, `${marks.length} 个`);
check('平均间隔约 1 秒', avgGap < 1800, `平均 ${Math.round(avgGap)}ms`);
const ones = await p.evaluate(() => window.__geo.ones);
check('打点路径不再逐个现取定位', ones === 0, `getCurrentPosition 调用 ${ones} 次`);

console.log('\nG2 手动打点直接读缓存');
// 自动打点跑着时「记录位置」是禁用的，先停掉；监听还开着、缓存还是新的
await p.getByRole('button', { name: '⏹ 停止自动打点' }).click();
await p.waitForTimeout(300);
const before = await pts();
const t1 = Date.now();
await p.getByRole('button', { name: '记录位置', exact: true }).click();
await p.waitForTimeout(300);
let manualMs = -1;
for (let i = 0; i < 40; i += 1) {
  if ((await pts()) > before) {
    manualMs = Date.now() - t1;
    break;
  }
  await p.waitForTimeout(100);
}
check('「记录位置」几乎立刻出点', manualMs >= 0 && manualMs < 1500, `${manualMs}ms`);
const ones2 = await p.evaluate(() => window.__geo.ones);
check('手动打点也没现取定位', ones2 === 0, `getCurrentPosition 调用 ${ones2} 次`);
await p.waitForTimeout(300);

console.log('\nG3 离开后不再常驻监听');
const g1 = await p.evaluate(() => window.__geo);
check('面板打开期间开过监听', g1.watches >= 1, `watchPosition ${g1.watches} 次`);
await p.locator('.tabbar-item', { hasText: '人物' }).click();
await p.waitForTimeout(800);
const g2 = await p.evaluate(() => window.__geo);
check('离开面板后关掉监听', g2.clears >= g2.watches, `watch ${g2.watches} / clear ${g2.clears}`);

console.log('\nG4 刷新后重新打开仍能立刻打点');
await p.reload({ waitUntil: 'load' });
await waitBoot();
await toLocation();
await tab('记录').click();
await p.waitForTimeout(500);
const c0 = await pts();
const t2 = Date.now();
await p.getByRole('button', { name: '记录位置', exact: true }).click();
let afterReloadMs = -1;
for (let i = 0; i < 40; i += 1) {
  if ((await pts()) > c0) {
    afterReloadMs = Date.now() - t2;
    break;
  }
  await p.waitForTimeout(100);
}
check('刷新后手动打点照样出点', afterReloadMs >= 0, `${c0} → ${await pts()}`);
check('刷新后也不用等一次完整定位', afterReloadMs >= 0 && afterReloadMs < 2500, `${afterReloadMs}ms`);
const ones3 = await p.evaluate(() => window.__geo.ones);
check('刷新后先靠监听拿点', ones3 === 0, `getCurrentPosition 调用 ${ones3} 次`);

await browser.close();

console.log('\n========== 汇总 ==========');
if (failures.length) {
  console.log(`${failures.length} 项失败：`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('全部通过 ✓');
