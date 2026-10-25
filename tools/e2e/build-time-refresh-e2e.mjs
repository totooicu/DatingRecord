// 人物主页「最新版本 · …」双击刷新的界面回归。
//
// R1 人物主页标题上方显示构建时间，title 里带完整时间与「双击刷新」提示
// R2 单击不刷新（避免误触把正在浏览的人刷掉）
// R3 双击这一行真的重新加载：文档级标记被清掉、首屏 boot 重新走一遍
// R4 刷新后回到人物主页，「最新版本 · …」还在（没有跳到欢迎页或别处）
//
// 依赖：`npm run build` 后用静态服务器起 dist（vite preview 即可）。
// 用法：node tools/e2e/build-time-refresh-e2e.mjs [url]

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

console.log('\n=== 人物主页：双击构建时间刷新 ===');

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
// 空库会先落在欢迎页，点「载入示例数据」回到人物主页（与其它 e2e 同一套起步方式）
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(3000);
}
await waitBoot();

// R1 构建时间这一行：文案 + title 提示
const line = p.locator('.pane-build-time').first();
const text = ((await line.textContent()) ?? '').trim();
check('标题上方显示构建时间', /^最新版本 · \S+/.test(text), text);
const title = (await line.getAttribute('title')) ?? '';
check('title 带完整构建时间与双击提示', /\d{4}-\d{2}-\d{2}T/.test(title) && title.includes('双击刷新'), title);

// 数一次导航次数：浏览器里只有真实重新加载才会触发
let navCount = 0;
p.on('framenavigated', (frame) => {
  if (frame === p.mainFrame()) navCount += 1;
});

// R2 单击不刷新
await p.evaluate(() => {
  window.__drProbe = 'alive';
});
await line.click();
await p.waitForTimeout(800);
check('单击不触发刷新', navCount === 0, `navigated ${navCount}`);
check('单击后仍是同一份文档', (await p.evaluate(() => window.__drProbe ?? null)) === 'alive');

// R3 双击 → 重新加载
await line.dblclick();
await p.waitForTimeout(1500);
check('双击触发重新加载', navCount > 0, `navigated ${navCount}`);
await waitBoot();
check('刷新后是新的文档（标记已清）', (await p.evaluate(() => window.__drProbe ?? null)) === null);

// R4 刷新后还在人物主页
await p.locator('.pane-build-time').first().waitFor({ state: 'visible', timeout: 10000 });
const after = ((await p.locator('.pane-build-time').first().textContent()) ?? '').trim();
check('刷新后仍停在人物主页且时间还在', /^最新版本 · \S+/.test(after), after);
check('刷新后落在「人物」页签', (await p.locator('.home-head').first().textContent()).includes('人物'));

await ctx.close();
await browser.close();

console.log(`\n========== 汇总 ==========\n${failures.length ? `失败 ${failures.length} 项：${failures.join(' / ')}` : '全部通过 ✓'}`);
process.exit(failures.length ? 1 : 0);
