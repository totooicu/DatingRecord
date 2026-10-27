// 定位「自动打点」后台服务 e2e（src/core/runtime/locationAuto.ts 单例化之后的回归）。
//
// 验证：
//   L1 开机即注册「自动打点」服务（未运行，服务页列得出）
//   L2 面板里开始打点 → head 出服务图标
//   L3 离开面板（回主页）：服务仍在跑——图标在、行数继续涨（真后台，不随页面卸载）
//   L4 服务页显示「运行中」，点「打开」回面板
//   L5 停止后 head 图标消失
//
// 依赖：vite preview + 浏览器定位权限（Playwright context 级 mock）。
// 用法：node tools/e2e/location-service-e2e.mjs [url]

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

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['geolocation'],
  geolocation: { latitude: 31.2304, longitude: 121.4737 },
});
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

await p.goto(APP, { waitUntil: 'load' });
await p.waitForFunction(
  () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
  null,
  { timeout: 90000 },
);
const hasSeed = await p.getByText('载入示例数据看看效果').count();
if (hasSeed) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(3000);
}

// ---- L1：开机即注册（未运行） ----
await p.locator('.hs-text', { hasText: '服务' }).click();
await p.waitForTimeout(700);
const listed = await p.getByText('自动打点').count();
check('L1：开机即注册「自动打点」服务（未运行）', listed >= 1);
await p.locator('.page-head .back-btn').first().click();
await p.waitForTimeout(500);

// ---- 进定位面板，建文件，开始打点 ----
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(500);
await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
await p.waitForTimeout(500);
await p.locator('.settings-hub-title', { hasText: '定位' }).first().click();
await p.waitForTimeout(1500);
check('L2：定位面板打开 + leaflet 挂上', (await p.locator('.leaflet-container').count()) >= 1);

await p.getByRole('tab', { name: '文件' }).click();
await p.waitForTimeout(500);
await p.locator('input[aria-label="新定位文件名"]').fill('后台打点');
await p.getByRole('button', { name: '新建', exact: true }).click();
await p.waitForTimeout(1200);
check('L2：新建后回到「记录」页且已选中文件', (await p.locator('.loc-card-head', { hasText: '后台打点' }).count()) >= 1);
await p.getByRole('button', { name: '▶ 自动打点' }).click();
await p.waitForTimeout(2500);
const svcIcons = await p.locator('.page-head-right .hs-svc').count();
check('L2：开始打点后 head 出现服务图标', svcIcons >= 1, `count=${svcIcons}`);

// ---- L3：离开面板，服务照跑 ----
await p.locator('.tabbar-item', { hasText: '人物' }).click();
await p.waitForTimeout(600);
const homeIcon = await p.locator('.hs-svc').count();
check('L3：离开面板后 head 服务图标仍在', homeIcon >= 1, `count=${homeIcon}`);
await p.waitForTimeout(2500);
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(1200);
check('L3：设置 tab 直接回到定位面板（记住上次子页）', (await p.locator('.leaflet-container').count()) >= 1);
const rowsGrew = await p.locator('.music-list li').count();
check('L3：离开期间打点继续（列表有点）', rowsGrew >= 1, `li=${rowsGrew}`);

// ---- L4：服务页运行中 + 打开回面板 ----
await p.locator('.tabbar-item', { hasText: '人物' }).click();
await p.waitForTimeout(500);
await p.locator('.hs-text', { hasText: '服务' }).click();
await p.waitForTimeout(700);
const runningSub = await p
  .locator('.svc-row', { hasText: '自动打点' })
  .locator('.svc-sub')
  .textContent()
  .catch(() => '');
check('L4：服务页显示自动打点运行中', String(runningSub).includes('运行中'), `sub=${runningSub}`);
await p.locator('.svc-row', { hasText: '自动打点' }).locator('.svc-open').click();
await p.waitForTimeout(1200);
check('L4：服务页「打开」跳回定位面板', (await p.locator('.leaflet-container').count()) >= 1);

// ---- L5：停止后图标消失 ----
await p.getByRole('tab', { name: '记录' }).click();
await p.waitForTimeout(500);
await p.getByRole('button', { name: '⏹ 停止自动打点' }).click();
await p.waitForTimeout(800);
await p.locator('.tabbar-item', { hasText: '人物' }).click();
await p.waitForTimeout(600);
const afterStop = await p.locator('.home-head .hs-svc').count();
check('L5：停止后 head 服务图标消失', afterStop === 0, `count=${afterStop}`);

await browser.close();

console.log('\n========== 汇总 ==========');
if (failures.length) {
  console.log(`${failures.length} 项失败：`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('全部通过 ✓');
process.exit(0);
