// 重复 hash 管理面板 + 按 hash 搜索的回归。
//
// 重复记录是历史攒下来的：改名重传、当初选了「都不一样」、迁移留下的副本。
// 这个脚本走一遍真实路径：先造出一组同 hash 的两条记录，再在面板里
// 合并（引用改指目标、源记录删除）与标记为不同内容（退出判重、可取消），
// 并验证「在列表里搜」真的把 hash 填进搜索框、列表只剩这一组。
//
// 依赖：pnpm build && pnpm preview（默认 http://localhost:4173/）+ playwright。
// 用法：node tools/e2e/dup-hash-e2e.mjs [url]
//      PLAYWRIGHT=/path/to/playwright/index.mjs 覆盖模块路径

import fs from 'node:fs';

let chromium;
try {
  ({ chromium } = await import(process.env.PLAYWRIGHT || '/usr/local/node/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('playwright'));
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
const pageErrors = [];
p.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
p.on('dialog', (d) => d.accept());

const waitBoot = () =>
  p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );

/** >1MB 的同内容文件：判重会走到「交给用户判断」的分支，选「都不一样」就留下重复记录 */
const big = (name, seed) => ({
  name,
  mimeType: 'application/octet-stream',
  buffer: Buffer.from(Array.from({ length: 1_250_000 }, (_v, i) => (i * 37 + seed) % 249)),
});

const summary = p.locator('.dup-entry > summary');
const groups = p.locator('.dup-group');
const rows = () => p.locator('.file-list .file-item').count();
const searchBox = p.locator('.file-search');
const btn = (name) => p.getByRole('button', { name });

/** 传一个文件，撞到冲突弹窗就按 onCollision 处置 */
const upload = async (file, action) => {
  await p.locator('input[type=file]').first().setInputFiles([file]);
  if (action) {
    await p.waitForSelector('text=这个文件可能与已有的相同', { timeout: 30000 });
    await btn(action).click();
  }
  await p.waitForFunction(
    (n) => document.querySelector('.file-list')?.innerText.includes(n),
    file.name,
    { timeout: 60000 },
  );
};

console.log('\n=== 重复 hash 管理：合并 / 标记不同内容 / 按 hash 搜索 ===');

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(3000);
}

await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(600);
await p.locator('.settings-nav-title', { hasText: /^文件$/ }).first().click();
await p.waitForTimeout(800);
check('S1 文件页有重复 hash 入口', (await summary.count()) === 1, `count=${await summary.count()}`);
check('S2 收起时不挂载面板', (await groups.count()) === 0);

// 1. 造一组重复：第二条选「都不一样」，于是同一 hash 挂了两条记录
await upload(big('dup.bin', 1));
await upload(big('dup2.bin', 1), '都不一样，作为新文件');
check('A1 标题报出待处理组数', /重复 hash 管理 · 1 组待处理/.test(await summary.innerText()), await summary.innerText());

// 2. 展开面板
await summary.click();
await p.waitForTimeout(600);
check('A2 展开后才列出分组', (await groups.count()) === 1, `groups=${await groups.count()}`);
const card = groups.first();
check('A3 组里两条记录都在', /dup\.bin/.test(await card.innerText()) && /dup2\.bin/.test(await card.innerText()));
check(
  'A4 默认保留引用面最小的那条（先传的 dup.bin）',
  /dup\.bin/.test(await card.locator('.dup-file-on').innerText()),
  await card.locator('.dup-file-on').innerText(),
);

// 3. 按 hash 搜索：面板收起、搜索框装下整串 sha256、列表只剩这一组
const rowAll = await rows();
await card.getByRole('button', { name: '在列表里搜' }).click();
await p.waitForTimeout(800);
const q = await searchBox.inputValue();
check('B1 hash 已填进搜索框', /^[0-9a-f]{64}$/.test(q), `value=${q.slice(0, 20)}…`);
check('B2 列表只剩这一组的两条', (await rows()) === 2, `rows=${await rows()}`);
check('B3 面板自动收起', (await groups.count()) === 0);
await searchBox.fill('');
await p.waitForTimeout(600);
check('B4 清空搜索回到全部', (await rows()) === rowAll, `${rowAll} → ${await rows()}`);

// 4. 合并：其余那条的引用改指目标，源记录与二进制删掉
await summary.click();
await p.waitForTimeout(600);
await groups.first().getByRole('button', { name: /^合并其余/ }).click();
await p.waitForSelector('text=合并文件', { timeout: 15000 });
await btn('保留 dup2.bin').click();
check('C0 切换目标后选中态同步', await btn('保留 dup2.bin').getAttribute('aria-pressed') === 'true');
await btn('保留 dup.bin').click();
check('C0b 能切回原目标', await btn('保留 dup.bin').getAttribute('aria-pressed') === 'true');
await btn('保留 dup2.bin').click();
check('C0c 预览切换到新目标', (await p.getByText('「dup2.bin」将接收', { exact: false }).count()) === 1);
await btn('确认合并').click();
await p.waitForFunction(() => /已合并/.test(document.body.innerText), null, { timeout: 60000 });
check('C1 合并后提示写明结果', /已合并 1 个文件/.test(await p.locator('body').innerText()));
await p.waitForTimeout(1500);
check('C2 原目标作为源记录从列表消失', (await p.locator('.file-list').getByText('dup.bin', { exact: true }).count()) === 0);
check('C3 新选择的目标记录还在', (await p.locator('.file-list').getByText('dup2.bin', { exact: true }).count()) > 0);
check('C4 面板说没有待处理了', /没有待处理的同 hash 文件/.test(await p.locator('.dup').innerText()));
check('C5 标题不再报待处理组数', !/组待处理/.test(await summary.innerText()), await summary.innerText());

// 5. 标记为不同内容：整组退出判重，可取消
await upload(big('pair.bin', 5));
await upload(big('pair2.bin', 5), '都不一样，作为新文件');
await p.waitForTimeout(800);
const marked = p.locator('.dup-marked');
await groups.first().getByRole('button', { name: '标记为不同内容' }).click();
await p.waitForTimeout(1000);
check('D1 提示写明已标记', /标记为不同内容/.test(await p.locator('body').innerText()));
check('D2 整组归进「已确认」一栏', (await marked.count()) === 1 && /1 组/.test(await marked.locator('summary').innerText()));
check('D3 待处理区不再列这组', !/pair/.test(await p.locator('.dup > .dup-group').innerText().catch(() => '')));

// 6. 已确认的组仍能按 hash 搜到，取消标记后回到待处理
await marked.locator('summary').click();
await p.waitForTimeout(400);
await marked.locator('.dup-group').first().getByRole('button', { name: '在列表里搜' }).click();
await p.waitForTimeout(800);
check('E1 已确认的组也能按 hash 搜', (await rows()) === 2, `rows=${await rows()}`);
await searchBox.fill('');
await summary.click();
await p.waitForTimeout(600);
await marked.locator('summary').click();
await p.waitForTimeout(400);
await marked.locator('.dup-group').first().getByRole('button', { name: '取消标记，重新当重复' }).click();
await p.waitForTimeout(1000);
check('E2 取消标记后回到待处理', /1 组待处理/.test(await summary.innerText()), await summary.innerText());

check('无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
console.log(failures.length ? `\n失败 ${failures.length} 项：${failures.join(', ')}` : '\n全部通过');
process.exit(failures.length ? 1 : 0);
