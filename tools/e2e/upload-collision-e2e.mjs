// 上传冲突弹窗回归：覆盖、二进制缺失提示、本批「后续同样处理」。
//
// 场景取自真实故障：库里有一条元数据在、IndexedDB 二进制没了的记录（就是"打不开"的文件）。
// 重新上传同一个文件时应当：弹窗标出「二进制缺失」、允许「覆盖」把内容补回去，
// 且覆盖不换引用名；勾了「后续同样处理」之后，本批剩余冲突不再弹窗；
// 「取消上传」则这一条直接跳过，不再悄悄插一条记录。
//
// 依赖：pnpm build && pnpm preview（默认 http://localhost:4173/）+ playwright。
// 用法：node tools/e2e/upload-collision-e2e.mjs [url]
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

const waitBoot = async () => {
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );
};

/** 造一个 >1MB 的文件，确保走"大文件交给用户判断"的分支 */
const big = (name, seed) => ({
  name,
  mimeType: 'application/octet-stream',
  buffer: Buffer.from(Array.from({ length: 1_250_000 }, (_v, i) => (i * 31 + seed) % 251)),
});

/** 直接操作 IndexedDB 的 blobs store：列键、删某一个键
 *  删键而不是清库：只把这次要测的那条变成「元数据在、二进制没了」的坏记录，
 *  示例数据自带的附件不受影响，计数才有稳定的基线。 */
const idbKeys = () =>
  p.evaluate(async () => {
    const d = await new Promise((res, rej) => {
      const r = indexedDB.open('dating-record', 3);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const t = d.transaction('blobs', 'readonly');
    return await new Promise((res) => {
      const q = t.objectStore('blobs').getAllKeys();
      q.onsuccess = () => res(q.result.map(String));
    });
  });

const idbDel = (key) =>
  p.evaluate(async (k) => {
    const d = await new Promise((res, rej) => {
      const r = indexedDB.open('dating-record', 3);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const t = d.transaction('blobs', 'readwrite');
    t.objectStore('blobs').delete(k);
    await new Promise((res) => (t.oncomplete = res));
    return true;
  }, key);

console.log('\n=== 上传冲突：覆盖 / 缺失提示 / 后续同样处理 ===');

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(3000);
}

// 进 设置 → 文件
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(600);
await p.locator('.settings-nav-title', { hasText: /^文件$/ }).first().click();
await p.waitForTimeout(800);
const fileInput = p.locator('input[type=file]').first();
check('S1 文件页有上传入口', (await fileInput.count()) === 1);

// 1. 先正常传一个文件建记录
const list = p.locator('.file-list');
const rows = () => list.locator('.file-item').count();
const btn = (name) => p.getByRole('button', { name });
const kBase = await idbKeys();
await fileInput.setInputFiles([big('alpha.bin', 1)]);
await p.waitForFunction(() => document.querySelector('.file-list')?.innerText.includes('alpha.bin'), null, {
  timeout: 60000,
});
check('U1 首个文件已入库', (await list.getByText('alpha.bin').count()) > 0);
const kAfter = await idbKeys();
const alphaKey = kAfter.filter((k) => !kBase.includes(k));
check('U1b 首个文件写入了二进制', alphaKey.length === 1, `新增 ${alphaKey.length} 个 blob`);

// 2. 人为删掉它的二进制，模拟「元数据在、内容没了」的坏记录
await idbDel(alphaKey[0]);
check('U2 二进制已删掉（坏记录造好）', !(await idbKeys()).includes(alphaKey[0]));

// 3. 重新上传同内容不同名的文件 → 应当弹窗，且标出「二进制缺失」
const row0 = await rows();
await fileInput.setInputFiles([big('beta.bin', 1)]);
await p.waitForSelector('text=这个文件可能与已有的相同', { timeout: 30000 });
check('U3 同 hash 同大小的第二个文件触发弹窗', true);
check('U4 弹窗标出候选的二进制缺失', (await p.getByText('二进制缺失').count()) > 0);
check('U5 弹窗有「覆盖所选」按钮', (await btn('覆盖所选').count()) === 1);
check('U6 弹窗有「后续同样处理」勾选', (await p.locator('.col-rest input').count()) === 1);

// 4. 覆盖：二次确认 → 内容补回，引用名不变，不新增记录
await btn('覆盖所选').click();
check('U7 覆盖前要求二次确认', (await p.getByText('旧内容不保留，撤销不了').count()) > 0);
await btn('确认覆盖').click();
await p.waitForFunction(() => document.body.innerText.includes('已覆盖'), null, { timeout: 60000 });
check('U8 覆盖后二进制补回来了', (await idbKeys()).includes(alphaKey[0]));
check('U9 提示里写明已覆盖', /已覆盖 alpha\.bin/.test(await p.locator('body').innerText()));
check('U10 覆盖不换名（列表里仍是 alpha.bin）', (await list.getByText('alpha.bin').count()) > 0);
check('U11 覆盖不新增记录（列表里没有 beta.bin）', (await list.getByText('beta.bin').count()) === 0);
check('U12 覆盖不动记录条数', (await rows()) === row0, `${row0} → ${await rows()}`);

// 5. 「后续同样处理」：三个同内容文件，第一次问、后面自动
const rowGamma = await rows();
const kGammaBase = await idbKeys();
await fileInput.setInputFiles([big('gamma.bin', 7), big('gamma2.bin', 7), big('gamma3.bin', 7)]);
await p.waitForSelector('text=这个文件可能与已有的相同', { timeout: 30000 });
await p.locator('.col-rest input').check();
await btn('复用所选').click();
await p.waitForFunction(() => document.body.innerText.includes('按前面的选择'), null, { timeout: 60000 });
const tip = await p.locator('body').innerText();
check('V1 后面的冲突没有再弹窗', (await p.getByText('这个文件可能与已有的相同').count()) === 0);
check('V2 提示里写明按前面的选择处理', /按前面的选择复用已有/.test(tip), tip.slice(-200));
check('V3 只新增一条（gamma.bin，另两条复用）', (await rows()) === rowGamma + 1, `${rowGamma} → ${await rows()}`);
check('V4 gamma2 / gamma3 没有落成记录', (await list.getByText(/gamma[23]\.bin/).count()) === 0);
const kGammaAfter = await idbKeys();
check(
  'V5 只有新建那条写了二进制，复用不占空间',
  kGammaAfter.filter((k) => !kGammaBase.includes(k)).length === 1,
  `新增 ${kGammaAfter.filter((k) => !kGammaBase.includes(k)).length} 个 blob`,
);

// 6. 「取消上传」= 这条不落库（以前取消也会偷偷插一条新记录）
const rowCancel = await rows();
await fileInput.setInputFiles([big('alpha.bin', 1)]);
await p.waitForSelector('text=这个文件可能与已有的相同', { timeout: 30000 });
await btn('取消上传').click();
await p.waitForSelector('text=这个文件可能与已有的相同', { state: 'hidden', timeout: 30000 });
await p.waitForTimeout(1500);
check('W1 取消后不弹窗了', (await p.getByText('这个文件可能与已有的相同').count()) === 0);
check('W2 取消的这条没有落库', (await rows()) === rowCancel, `${rowCancel} → ${await rows()}`);

check('无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
console.log(failures.length ? `\n失败 ${failures.length} 项：${failures.join(', ')}` : '\n全部通过');
process.exit(failures.length ? 1 : 0);
