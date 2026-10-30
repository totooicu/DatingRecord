// 压测页性能测量：载入 10000 条压测数据后，分别给日历 / 时间线 / 人物页计时。
// 用法：node tools/e2e/perf-measure-e2e.mjs [url] [scale]
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
const SCALE = process.argv[3] || '10000';
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'dr-perf-'));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
p.on('dialog', (d) => d.accept());

const waitBoot = async () => {
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null, { timeout: 90000 },
  );
};

const timing = (label) => p.evaluate((l) => {
  const m = performance.getEntriesByName(l);
  return m.length ? m[m.length - 1].duration : -1;
}, label);

console.log(`\n=== 性能测量（scale=${SCALE}）===\n`);

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();

// 关掉欢迎页
if (await p.getByText('直接开始创建').count()) {
  await p.getByText('直接开始创建').click();
  await p.waitForTimeout(500);
}
const closeBtn = p.locator('[aria-label="关闭"]').first();
if (await closeBtn.count()) { await closeBtn.click(); await p.waitForTimeout(300); }

// 进设置 → 数据与统计 → 压测数据
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(400);
await p.locator('.settings-nav-title', { hasText: '数据与统计' }).click();
await p.waitForTimeout(500);

// 选量级：按钮文本被 fmt 加了千分位，按序号点最稳
const TIERS = ['10', '100', '1000', '10000'];
const tierIdx = TIERS.indexOf(String(SCALE));
if (tierIdx < 0) throw new Error(`未知量级 ${SCALE}`);
await p.locator('.sample-tier .theme-mode-btn').nth(tierIdx).click();
await p.waitForTimeout(200);

// 载入压测数据
const loadBtn = p.getByRole('button', { name: /载入压测数据/ });
const tSeed0 = Date.now();
await loadBtn.click();
// 等忙状态结束：按钮文字回到「载入压测数据…」且不再「正在造数据」
await p.waitForFunction(() => {
  const el = [...document.querySelectorAll('button')].find((b) => /载入压测数据/.test(b.textContent || ''));
  return el && !/正在造数据/.test(el.textContent || '');
}, null, { timeout: 180000 });
const tSeed1 = Date.now();
console.log(`  · 载入 ${SCALE} 条压测数据：${((tSeed1 - tSeed0) / 1000).toFixed(1)}s`);

// 测量日历
const openCal = async () => {
  await p.evaluate(() => performance.clearMarks());
  const t0 = Date.now();
  await p.locator('.tabbar-item', { hasText: '日历' }).click();
  await p.waitForSelector('.cal-scroll .cal-week', { timeout: 120000 });
  await p.waitForTimeout(250);
  const t1 = Date.now();
  return (t1 - t0) / 1000;
};
const cal1 = await openCal();
const cal2 = await openCal(); // 第二次（已懒加载 + 数据已在内存）
console.log(`  · 打开日历：${cal1.toFixed(1)}s（首开）/ ${cal2.toFixed(1)}s（再开）`);

// 测量时间线
const openTimeline = async () => {
  const t0 = Date.now();
  await p.locator('.tabbar-item', { hasText: '时间线' }).click();
  await p.waitForSelector('.timeline', { timeout: 120000 });
  await p.waitForTimeout(250);
  const t1 = Date.now();
  return (t1 - t0) / 1000;
};
const tl1 = await openTimeline();
const tl2 = await openTimeline();
console.log(`  · 打开时间线：${tl1.toFixed(1)}s（首开）/ ${tl2.toFixed(1)}s（再开）`);

// 测量人物
const openPersons = async () => {
  const t0 = Date.now();
  await p.locator('.tabbar-item', { hasText: '人物' }).click();
  await p.waitForSelector('.list-item', { timeout: 120000 });
  await p.waitForTimeout(250);
  const t1 = Date.now();
  return (t1 - t0) / 1000;
};
const pe1 = await openPersons();
const pe2 = await openPersons();
console.log(`  · 打开人物：${pe1.toFixed(1)}s（首开）/ ${pe2.toFixed(1)}s（再开）`);

console.log(`\n  控制台错误数：${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('    ! ' + e);

await browser.close();
