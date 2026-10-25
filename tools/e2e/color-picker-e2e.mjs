// 取色面板 e2e：彩虹在左、历史在右、HEX / RGB 输入。
//
// 覆盖：
//   C1 外观 → 自定义颜色：展开共用取色面板，彩虹区在左、历史区在右
//   C2 HEX 输入立即应用主题色
//   C3 RGB 输入立即应用主题色
//   C4 彩虹区拖动可以取色
//   C5 历史颜色会记住并在刷新后保留
//   C6 事件集图标：自定义背景色 → 保存后图标生效，颜色进入历史
//
// 依赖：`pnpm build` 后用静态服务器起 dist，再装 playwright。
// 用法：node tools/e2e/color-picker-e2e.mjs [url]

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
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'dr-color-'));

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
  await p.waitForTimeout(500);
  for (let i = 0; i < 4; i += 1) {
    if (await p.locator('.settings-nav-title').first().isVisible().catch(() => false)) return;
    const back = p.locator('.back-btn').first();
    if (!(await back.count())) return;
    await back.click();
    await p.waitForTimeout(300);
  }
};

const openAppearancePicker = async () => {
  await toSettingsRoot();
  await p.locator('.settings-nav-title', { hasText: /^外观$/ }).click();
  await p.waitForTimeout(600);
  const toggle = p.getByRole('button', { name: /自定义颜色|收起调色板/ });
  if ((await toggle.textContent())?.includes('自定义')) await toggle.click();
  await p.waitForTimeout(400);
};

/** 主题色落在根节点的内联 CSS 变量上，直接读比 getComputedStyle 稳 */
const accentVar = () =>
  p.evaluate(() => document.documentElement.style.getPropertyValue('--primary').trim());

console.log('\n=== 取色面板 端到端 ===');

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(2500);
}

console.log('\nC1 外观自定义面板布局');
await openAppearancePicker();
check('取色面板已展开', (await p.locator('.theme-picker .cp').count()) === 1);
check('彩虹区存在', (await p.locator('.cp-rainbow').count()) === 1);
check('历史区存在', (await p.locator('.cp-history').count()) === 1);
const layout = await p.evaluate(() => {
  const r = document.querySelector('.cp-rainbow')?.getBoundingClientRect();
  const h = document.querySelector('.cp-history')?.getBoundingClientRect();
  return r && h ? { rRight: r.right, hLeft: h.left, rh: r.height } : null;
});
check('彩虹在左、历史在右', !!layout && layout.rRight <= layout.hLeft + 1, JSON.stringify(layout));
await p.screenshot({ path: path.join(SHOTS, 'color-appearance.png') });

console.log('\nC2 HEX 输入');
await p.locator('.theme-picker .cp-hex').fill('#1a73e8');
await p.locator('.theme-picker .cp-hex').blur();
await p.waitForTimeout(500);
check('HEX 生效（主题色变量）', (await accentVar()).toLowerCase() === '#1a73e8', await accentVar());
check(
  'RGB 输入框跟着 HEX 走',
  (await p.locator('.theme-picker .cp-rgb input').nth(1).inputValue()) === '115',
  await p.locator('.theme-picker .cp-rgb input').nth(1).inputValue(),
);

console.log('\nC3 RGB 输入');
const rgbInputs = p.locator('.theme-picker .cp-rgb input');
await rgbInputs.nth(0).fill('200');
await rgbInputs.nth(1).fill('30');
await rgbInputs.nth(2).fill('90');
await rgbInputs.nth(2).blur();
await p.waitForTimeout(500);
check('RGB 生效（200,30,90 → #c81e5a）', (await accentVar()).toLowerCase() === '#c81e5a', await accentVar());
check(
  'HEX 输入框跟着 RGB 走',
  (await p.locator('.theme-picker .cp-hex').inputValue()) === '#c81e5a',
  await p.locator('.theme-picker .cp-hex').inputValue(),
);

console.log('\nC4 彩虹拖动取色');
const box = await p.locator('.theme-picker .cp-rainbow').boundingBox();
const before = await p.locator('.theme-picker .cp-hex').inputValue();
await p.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.62);
await p.mouse.down();
await p.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.6, { steps: 4 });
await p.mouse.up();
await p.waitForTimeout(500);
const after = await p.locator('.theme-picker .cp-hex').inputValue();
check('拖动彩虹后取到新颜色', after !== before && /^#[0-9a-f]{6}$/.test(after), `${before} → ${after}`);
check('拖动结果同步到主题色', (await accentVar()).toLowerCase() === after, `${await accentVar()} vs ${after}`);
await p.screenshot({ path: path.join(SHOTS, 'color-dragged.png') });

console.log('\nC5 历史颜色');
const hist = p.locator('.theme-picker .cp-hist');
const histCount = await hist.count();
check('历史里已记录用过的颜色', histCount >= 3, `count=${histCount}`);
check(
  '最新颜色排在最前',
  (await hist.first().getAttribute('title')) === after,
  `${await hist.first().getAttribute('title')} vs ${after}`,
);

await p.reload({ waitUntil: 'load' });
await waitBoot();
await p.waitForTimeout(800);
await openAppearancePicker();
check(
  '刷新后历史仍在（localStorage）',
  (await p.locator('.theme-picker .cp-hist').count()) >= 3,
);
check('刷新后主题色仍是拖动结果', (await accentVar()).toLowerCase() === after, await accentVar());

console.log('\nC6 事件集图标自定义颜色');
await p.locator('.tabbar-item', { hasText: '事件集' }).click();
await p.waitForTimeout(900);
await p.locator('.tree-name').first().click();
await p.waitForTimeout(900);
await p.locator('.head-icon-btn').first().click();
await p.waitForTimeout(600);
check('图标选择器已打开', (await p.locator('.icon-picker').count()) === 1);
await p.locator('button[aria-label="自定义背景色"]').click();
await p.waitForTimeout(400);
check('图标配色里能展开同一套取色面板', (await p.locator('.icon-picker .cp').count()) === 1);
check('图标面板也是彩虹在左历史在右', (await p.locator('.icon-picker .cp-rainbow').count()) === 1 && (await p.locator('.icon-picker .cp-history').count()) === 1);
await p.locator('.icon-picker .cp-hex').fill('#123456');
await p.locator('.icon-picker .cp-hex').blur();
await p.waitForTimeout(400);
await p.screenshot({ path: path.join(SHOTS, 'color-icon-picker.png') });
// 文字类图标必须至少有一个字，否则保存会报错、弹窗不关
const iconText = p.locator('.icon-picker .icon-text-input');
if (await iconText.count()) {
  if (!(await iconText.inputValue()).trim()) await iconText.fill('测');
}
await p.locator('.modal .btn-primary', { hasText: '保存' }).click();
await p.waitForTimeout(900);
const modalGone = (await p.locator('.icon-picker').count()) === 0;
check('图标保存后弹窗关闭', modalGone, modalGone ? '' : await p.locator('.lock-err').first().textContent().catch(() => ''));
const bg = await p.evaluate(() => {
  const el = document.querySelector('.head-icon-btn .coll-icon');
  return el ? getComputedStyle(el).backgroundColor : '';
});
check('图标背景用了自定义色', bg === 'rgb(18, 52, 86)', bg);

console.log('\nC6b 图标用过的颜色进入历史');
await openAppearancePicker();
check(
  '历史第一项是图标刚选的 #123456',
  (await p.locator('.theme-picker .cp-hist').first().getAttribute('title')) === '#123456',
  `${await p.locator('.theme-picker .cp-hist').first().getAttribute('title')}`,
);

await p.screenshot({ path: path.join(SHOTS, 'color-history.png') });
await browser.close();

console.log(`\n截图目录：${SHOTS}`);
console.log('\n========== 汇总 ==========');
if (failures.length) {
  console.log(`${failures.length} 项失败：`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('全部通过 ✓');
