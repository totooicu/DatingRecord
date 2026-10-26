// 夜间模式 e2e：浅/深开关、变量贴根、主按钮白字翻深色、刷新持久化。
//
// 用法：node tools/e2e/dark-mode-e2e.mjs [url]

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
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'dr-dark-'));

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

const openAppearance = async () => {
  await toSettingsRoot();
  await p.locator('.settings-nav-title', { hasText: /^外观$/ }).click();
  await p.waitForTimeout(600);
};

const lum = (hex) => p.evaluate((h) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h.trim());
  if (!m) return 1;
  const lin = (v) => { const c = parseInt(v, 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
}, hex);

console.log('\n=== 夜间模式 端到端 ===');

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(2500);
}

// 先把模式复位到浅色，保证测试起点一致
await openAppearance();
if ((await p.evaluate(() => document.documentElement.dataset.mode)) !== 'light') {
  await p.getByRole('button', { name: '浅色' }).click();
  await p.waitForTimeout(300);
}

console.log('\nD1 切到深色');
await p.getByRole('button', { name: '深色' }).click();
await p.waitForTimeout(500);
check(':root data-mode=dark', (await p.evaluate(() => document.documentElement.dataset.mode)) === 'dark');
const bgDark = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
const panelDark = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--panel').trim());
check('深色底色确实偏暗（亮度<0.2）', (await lum(bgDark)) < 0.2, `bg=${bgDark} lum=${await lum(bgDark)}`);
check('深色面板也为暗色', (await lum(panelDark)) < 0.2, `panel=${panelDark}`);
// 明显偏色：bg 不该是中性灰——至少带一点饱和（偏离纯灰）
const satOk = await p.evaluate((h) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h.trim());
  if (!m) return false;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx - mn > 12; // 不是纯灰
}, bgDark);
check('深色底明显带主题色色调（非纯灰）', satOk, `bg=${bgDark}`);
await p.screenshot({ path: path.join(SHOTS, 'dark-appearance.png'), fullPage: true });

console.log('\nD2 主按钮白字翻深色');
const btnColor = await p.evaluate(() => {
  const el = document.querySelector('.theme-preview .btn-primary');
  return el ? getComputedStyle(el).color : '';
});
check('预览里的主按钮文字不是白字', btnColor && btnColor !== 'rgb(255, 255, 255)', btnColor);

console.log('\nD3 刷新后仍是深色（持久化）');
await p.reload({ waitUntil: 'load' });
await waitBoot();
await p.waitForTimeout(800);
check('刷新后 data-mode 仍为 dark', (await p.evaluate(() => document.documentElement.dataset.mode)) === 'dark');

console.log('\nD4 切回浅色');
await openAppearance();
await p.getByRole('button', { name: '浅色' }).click();
await p.waitForTimeout(500);
check('data-mode 回到 light', (await p.evaluate(() => document.documentElement.dataset.mode)) === 'light');
const bgLight = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
check('浅色底色确实浅（亮度>0.7）', (await lum(bgLight)) > 0.7, `bg=${bgLight} lum=${await lum(bgLight)}`);

await p.screenshot({ path: path.join(SHOTS, 'light-appearance.png'), fullPage: true });
await browser.close();

console.log(`\n截图目录：${SHOTS}`);
console.log('\n========== 汇总 ==========');
if (failures.length) {
  console.log(`${failures.length} 项失败：`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('全部通过 ✓');
