// 分享向导回归：四步能走完、每步容器对得上、退回不改坏。
//
// 2026-10-31 把这页 1011 行的单文件拆成 ./wizard/ 下的八个模块
// （model / PickCollections / PickPersons / PickLevel / PreviewStep /
//   PersonViewModal / EventViewModal / StepBar），这里钉住拆完还在的东西：
//   ① 四格步骤条 + 四个步骤各自的容器
//   ② 第 1 步没选事件集时「下一步」是禁用的，选了就能走
//   ③ 逐步走到第 4 步，预览区出现（.share-preview）
//   ④ 第 3 步选「自定义」会露出属性勾选区
//
// 用法：node tools/e2e/verify-share-wizard-e2e.mjs [url] [scale]
import fs from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const APP = process.argv[2] || 'http://localhost:4173/';
const SCALE = process.argv[3] || '100';
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

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) failed++;
  console.log(`  ${cond ? '✓' : '✗ 失败'} ${msg}`);
};

const waitBoot = () =>
  p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null, { timeout: 90000 },
  );

console.log(`\n=== 分享向导验证（scale=${SCALE}）===\n`);
await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
await p.addStyleTag({ content: '.fab{display:none!important}' });
if (await p.getByText('直接开始创建').count()) { await p.getByText('直接开始创建').click(); await p.waitForTimeout(500); }
const closeBtn = p.locator('[aria-label="关闭"]').first();
if (await closeBtn.count()) { await closeBtn.click(); await p.waitForTimeout(300); }

// ---------- 造数据（100 条：有事件集、有人物） ----------
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(400);
await p.locator('.settings-nav-title', { hasText: '数据与统计' }).click();
await p.waitForTimeout(500);
await p.locator('.sample-tier .theme-mode-btn').nth(['10', '100', '1000', '10000'].indexOf(String(SCALE))).click({ force: true });
await p.waitForTimeout(200);
await p.getByRole('button', { name: /载入压测数据/ }).click({ force: true });
await p.waitForFunction(() => {
  const el = [...document.querySelectorAll('button')].find((b) => /载入压测数据/.test(b.textContent || ''));
  return el && !/正在造数据/.test(el.textContent || '');
}, null, { timeout: 180000 });
await p.waitForTimeout(500);

// ---------- 从目录进「分享」 ----------
const backToNav = async () => {
  const b = p.locator('.back-btn').first();
  if (await b.count()) { await b.click({ force: true }); await p.waitForTimeout(400); }
};
await backToNav();
await p.locator('.settings-nav-title', { hasText: '备份与分享' }).click();
await p.waitForTimeout(400);
await p.locator('.settings-hub-title', { hasText: '分享' }).click();
await p.waitForTimeout(500);
await p.getByRole('button', { name: /开始分享/ }).click({ force: true });
await p.waitForTimeout(600);

// ---------- ① 步骤条 + 第 1 步 ----------
ok((await p.locator('.share-step').count()) === 4, `四格步骤条（实际 ${await p.locator('.share-step').count()}）`);
ok((await p.locator('.share-pick-list').count()) >= 1, '第 1 步列出可分享的事件集');
const nextBtn = p.getByRole('button', { name: '下一步' });
ok(await nextBtn.isDisabled(), '第 1 步没选任何事件集时「下一步」禁用');

// ---------- ② 选一个事件集就能走 ----------
await p.locator('.share-pick-row input[type=checkbox]:not([disabled])').first().check({ force: true });
await p.waitForTimeout(300);
ok(!(await nextBtn.isDisabled()), '选中一个事件集后「下一步」可点');
await nextBtn.click({ force: true });
await p.waitForTimeout(400);

// ---------- 第 2 步：人物 ----------
ok((await p.locator('.share-person-section').count()) >= 1, '第 2 步出现人物分组标题');
await p.getByRole('button', { name: '下一步' }).click({ force: true });
await p.waitForTimeout(400);

// ---------- ③ 第 3 步：程度 + 自定义露出属性 ----------
ok((await p.locator('.share-levels').count()) === 1, '第 3 步出现分享程度');
{
  const custom = p.locator('.share-level', { hasText: '自选' }).first();
  if (await custom.count()) {
    await custom.click({ force: true });
    await p.waitForTimeout(300);
    ok((await p.locator('.share-attrs').count()) === 1, '选「自定义」后露出属性勾选区');
    await p.locator('.share-level', { hasText: '原样' }).first().click({ force: true });
    await p.waitForTimeout(200);
  } else {
    console.log('  · 没找到「自定义」档，跳过属性区断言');
  }
}
await p.getByRole('button', { name: '下一步' }).click({ force: true });
await p.waitForTimeout(1500);

// ---------- ④ 第 4 步：预览 ----------
ok((await p.locator('.share-preview').count()) === 1, '第 4 步出现预览区');
{
  const txt = await p.locator('.share-summary').first().innerText().catch(() => '');
  ok(/事件集|事件|人物/.test(txt), `预览摘要有统计（${txt.replace(/\s+/g, ' ').slice(0, 60)}）`);
  const blocks = await p.locator('.share-block').count();
  ok(blocks === 3, `预览有三块：事件集 / 事件 / 人物（实际 ${blocks}）`);
}

// ---------- 退回第 1 步还能改 ----------
await p.getByRole('button', { name: '上一步' }).click({ force: true });
await p.waitForTimeout(300);
await p.getByRole('button', { name: '上一步' }).click({ force: true });
await p.waitForTimeout(300);
await p.getByRole('button', { name: '上一步' }).click({ force: true });
await p.waitForTimeout(400);
ok((await p.locator('.share-pick-list').count()) >= 1, '一路退回第 1 步，事件集列表还在');

// 关窗：有选择会先问一句
await p.getByRole('button', { name: '取消' }).first().click({ force: true });
await p.waitForTimeout(400);
ok((await p.getByText('取消这次分享？').count()) === 1, '有选择时关窗先弹确认');
await p.getByRole('button', { name: '放弃并关闭' }).click({ force: true });
await p.waitForTimeout(400);

console.log(`\n  断言失败数：${failed}；控制台错误数：${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('    ! ' + e);

await browser.close();
const clean = failed === 0 && errors.length === 0;
console.log(clean ? '\n全部通过 ✓' : '\n有失败项 ✗');
process.exit(clean ? 0 : 1);
