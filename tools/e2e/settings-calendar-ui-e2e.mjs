// 设置入口 / 日历配色的界面回归。
//
// S1 设置目录：功能体验、功能面板两个入口都有图标（曾经 panel 一族漏配，
//    目录和子页只剩一个空粉色方块）
// S2 功能面板子页：音乐 / 定位 / 高精度定位三条都有图标，和功能体验一致
// C1 日历事件条：底色按事件集配色散列，不再是写死的粉色
//    （样本数据 3 个集合，至少应出现 2 种不同底色；同一集合的事件同色）
//
// 依赖：`npm run build` 后用静态服务器起 dist，再装 playwright。
// 用法：node tools/e2e/settings-calendar-ui-e2e.mjs [url]

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
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
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

const toSettingsRoot = async () => {
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.waitForTimeout(400);
  for (let i = 0; i < 4; i += 1) {
    if (await p.locator('.settings-nav-title').first().isVisible().catch(() => false)) return;
    const back = p.locator('.back-btn').first();
    if (!(await back.count())) return;
    await back.click();
    await p.waitForTimeout(300);
  }
};

const navIconVisible = async (title) => {
  const item = p.locator('.settings-nav-item', { has: p.locator('.settings-nav-title', { hasText: title }) }).first();
  await item.scrollIntoViewIfNeeded();
  const svg = item.locator('.settings-nav-icon svg');
  if ((await svg.count()) !== 1) return false;
  const box = await svg.boundingBox();
  return !!box && box.width > 6 && box.height > 6;
};

const hubIcons = async () =>
  p.locator('.settings-hub-item').evaluateAll((els) =>
    els.map((el) => {
      const svg = el.querySelector('.settings-hub-icon svg');
      const box = svg?.getBoundingClientRect();
      return !!box && box.width > 6 && box.height > 6;
    }),
  );

console.log('\n=== 设置入口 / 日历配色 ===');

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(2500);
}

console.log('\nS1 设置目录图标');
await toSettingsRoot();
check('功能体验入口有图标', await navIconVisible('功能体验'));
check('功能面板入口有图标', await navIconVisible('功能面板'));

console.log('\nS2 二级入口图标');
await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
await p.waitForTimeout(500);
const panelIcons = await hubIcons();
check('功能面板 3 条都有图标', panelIcons.length === 3 && panelIcons.every(Boolean), JSON.stringify(panelIcons));
await p.locator('.back-btn').first().click();
await p.waitForTimeout(400);
await p.locator('.settings-nav-title', { hasText: '功能体验' }).click();
await p.waitForTimeout(500);
const labIcons = await hubIcons();
check('功能体验 2 条都有图标', labIcons.length === 2 && labIcons.every(Boolean), JSON.stringify(labIcons));

console.log('\nC1 日历事件条配色');
await p.locator('.tabbar-item', { hasText: '日历' }).click();
await p.waitForTimeout(1200);
const spans = await p.locator('.cal-span').evaluateAll((els) =>
  els.map((el) => ({
    title: el.textContent.trim(),
    bg: getComputedStyle(el).backgroundColor,
    fg: getComputedStyle(el).color,
  })),
);
check('日历上出现事件条', spans.length >= 3, `${spans.length} 条`);
const colors = [...new Set(spans.map((s) => s.bg))];
check('事件条底色不只一种（按事件集分色）', colors.length >= 2, colors.join(' / '));
check(
  '不再全部是写死的粉色 #fde8ef',
  spans.some((s) => s.bg !== 'rgb(253, 232, 239)'),
  colors.join(' / '),
);
check('每条都有前景色（文字可读）', spans.every((s) => !!s.fg && s.fg !== s.bg));

console.log(`\n========== 汇总 ==========\n${failures.length ? `失败 ${failures.length} 项：${failures.join('、')}` : '全部通过 ✓'}`);
await browser.close();
if (failures.length) process.exit(1);
