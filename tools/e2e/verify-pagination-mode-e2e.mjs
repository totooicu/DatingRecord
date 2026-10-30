// 验证：① 人物列表分页；② 陪伴/专注模式切换隐藏说明文字；③ 零控制台错误。
// 用法：node tools/e2e/verify-pagination-mode-e2e.mjs [url] [scale]
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const APP = process.argv[2] || 'http://localhost:4173/';
const SCALE = process.argv[3] || '1000';
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'dr-verify-'));
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
p.on('dialog', (d) => d.accept());

const waitBoot = async () => {
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null, { timeout: 90000 },
  );
};
const ok = (cond, msg) => console.log(`  ${cond ? '✓' : '✗ 失败'} ${msg}`);

console.log(`\n=== 验证（scale=${SCALE}）===\n`);
await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
// 测试环境：隐藏全局悬浮「记一件事」按钮，避免它挡住设置页按钮拦截点击。
// 注入到 <head>，React 不会重渲染 head，故子页面切换导致的重挂载也不会让它复活。
await p.addStyleTag({ content: '.fab{display:none!important}' });
if (await p.getByText('直接开始创建').count()) { await p.getByText('直接开始创建').click(); await p.waitForTimeout(500); }
const closeBtn = p.locator('[aria-label="关闭"]').first();
if (await closeBtn.count()) { await closeBtn.click(); await p.waitForTimeout(300); }

// ---------- 载入压测数据（从目录进入，避免进入子页后目录被隐藏） ----------
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(400);
// 测试环境里悬浮「记一件事」按钮会挡住设置页按钮，先隐掉它（仅测试副作用）
await p.evaluate(() => document.querySelectorAll('.fab').forEach((f) => (f.style.display = 'none')));
await p.locator('.settings-nav-title', { hasText: '数据与统计' }).click();
await p.waitForTimeout(500);
const TIERS = ['10', '100', '1000', '10000'];
const tierIdx = TIERS.indexOf(String(SCALE));
if (tierIdx < 0) throw new Error(`未知量级 ${SCALE}`);
await p.locator('.sample-tier .theme-mode-btn').nth(tierIdx).click({ force: true });
await p.waitForTimeout(200);
await p.getByRole('button', { name: /载入压测数据/ }).click({ force: true });
await p.waitForFunction(() => {
  const el = [...document.querySelectorAll('button')].find((b) => /载入压测数据/.test(b.textContent || ''));
  return el && !/正在造数据/.test(el.textContent || '');
}, null, { timeout: 180000 });
await p.waitForTimeout(500);

// ---------- ① 人物列表分页 ----------
await p.locator('.tabbar-item', { hasText: '人物' }).click();
await p.waitForSelector('.list-item', { timeout: 120000 });
await p.waitForTimeout(400);

const rendered = await p.locator('.list-item').count();
ok(rendered === 50, `人物列表每页渲染 50 条（实际 ${rendered}）`);

const pagerText = await p.locator('.pager-info').textContent().catch(() => null);
ok(!!pagerText && /第 1 \//.test(pagerText), `出现分页条且首页（"${pagerText}"）`);

const firstBefore = await p.locator('.list-item .list-item-title').first().textContent();
await p.locator('.pager-btn', { hasText: '下一页' }).click();
await p.waitForTimeout(400);
const pagerText2 = await p.locator('.pager-info').textContent().catch(() => null);
const firstAfter = await p.locator('.list-item .list-item-title').first().textContent();
ok(/第 2 \//.test(pagerText2 || ''), `点下一页跳到第 2 页（"${pagerText2}"）`);
ok(firstBefore !== firstAfter, `第 2 页首条与第 1 页不同（"${firstBefore}" → "${firstAfter}"）`);
ok((await p.locator('.list-item').count()) === 50, `第 2 页仍渲染 50 条`);

// ---------- ② 陪伴/专注模式 ----------
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(300);
// 若停留在某个设置子页（手机端目录被隐藏），先退回目录再点「外观」
const backBtn = p.locator('[aria-label="返回"]').first();
if (await backBtn.count()) { await backBtn.click(); await p.waitForTimeout(300); }
await p.locator('.settings-nav-title', { hasText: '外观' }).click();
await p.waitForTimeout(500);

const guideAttr = () => p.evaluate(() => document.documentElement.getAttribute('data-guide'));
const guideVisibleCount = () => p.evaluate(() => {
  const els = [...document.querySelectorAll('.guide-only')];
  return els.filter((e) => getComputedStyle(e).display !== 'none').length;
});

ok((await guideAttr()) === 'companion', `默认模式 = companion（实际 ${await guideAttr()}）`);
const guideShownDefault = await guideVisibleCount();

await p.getByRole('button', { name: '专注模式' }).click({ force: true });
await p.waitForTimeout(300);
ok((await guideAttr()) === 'focus', `切到专注模式 → data-guide=focus（实际 ${await guideAttr()}）`);
const guideShownFocus = await guideVisibleCount();
ok(guideShownFocus < guideShownDefault, `专注模式隐藏了说明文字（可见 ${guideShownDefault} → ${guideShownFocus}）`);

await p.getByRole('button', { name: '陪伴模式' }).click({ force: true });
await p.waitForTimeout(300);
ok((await guideAttr()) === 'companion', `切回陪伴模式 → data-guide=companion（实际 ${await guideAttr()}）`);
ok((await guideVisibleCount()) === guideShownDefault, `陪伴模式恢复说明文字（可见 ${await guideVisibleCount()}）`);

// ---------- ③ 文件列表分页 ----------
const backBtn2 = p.locator('[aria-label="返回"]').first();
if (await backBtn2.count()) { await backBtn2.click(); await p.waitForTimeout(300); }
await p.locator('.settings-nav-title', { hasText: '文件' }).click();
await p.waitForSelector('.file-list li', { timeout: 60000 });
await p.waitForTimeout(300);
const fileRows = await p.locator('.file-list li').count();
ok(fileRows === 50, `文件列表每页渲染 50 条（实际 ${fileRows}）`);
const filePager = await p.locator('.pager-info').textContent().catch(() => null);
ok(!!filePager && /第 1 \//.test(filePager), `文件分页条存在且首页（"${filePager}"）`);

console.log(`\n  控制台错误数：${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('    ! ' + e);

await browser.close();
console.log(errors.length === 0 ? '\n全部通过 ✓' : '\n存在控制台错误 ✗');
