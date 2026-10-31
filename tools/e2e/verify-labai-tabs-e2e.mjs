// AI 对话页回归：四个 tab 各占一屏、切换不中断、聊天区能打字。
//
// 这页原来是 1345 行的单文件，2026-10-31 拆成 ./labAi/ 下的十个模块
// （model / Attachments / SnapChips / ChatTab / HistoryTab / SnapTab / HelpTab /
//  三个弹窗）。这里钉住拆完还在的东西：
//   ① 四个 tab 都能点开，各自的类名容器出现
//   ② 聊天区能输入，Cmd/Ctrl+Enter 才发（Enter 只换行）
//   ③ 切换 tab 不卸载聊天：输入的内容切走再切回来还在
//   ④ 历史会话 / 成果空态用全站同一颗 Empty
//
// 用法：node tools/e2e/verify-labai-tabs-e2e.mjs [url]
import fs from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const APP = process.argv[2] || 'http://localhost:4173/';
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

console.log('\n=== AI 对话页验证 ===\n');
await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
await p.addStyleTag({ content: '.fab{display:none!important}' });
if (await p.getByText('直接开始创建').count()) { await p.getByText('直接开始创建').click(); await p.waitForTimeout(500); }
const closeBtn = p.locator('[aria-label="关闭"]').first();
if (await closeBtn.count()) { await closeBtn.click(); await p.waitForTimeout(300); }

// 进 AI 对话：设置 → AI → AI 对话
const backToNav = async () => {
  const b = p.locator('.back-btn').first();
  if (await b.count()) { await b.click({ force: true }); await p.waitForTimeout(400); }
};
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(400);
await p.locator('.settings-nav-title', { hasText: /^AI$/ }).click();
await p.waitForTimeout(500);
// 「AI」是 hub 页：对话 / 聊天提取 / 模型三页在它的二级目录里
await p.locator('.settings-hub-title', { hasText: 'AI 对话' }).click();
await p.waitForTimeout(800);

ok((await p.locator('.lab-page-chat').count()) === 1, 'AI 对话页打开（.lab-page-chat）');
ok((await p.locator('.aichat-tab').count()) === 4, `顶部四个 tab（实际 ${await p.locator('.aichat-tab').count()}）`);

// ---------- ① 四个 tab 依次点开 ----------
const TABS = [
  { name: '聊天', sel: '.aichat-chat' },
  { name: '历史会话', sel: '.aichat-history' },
  { name: '成果', sel: '.aichat-snaps' },
  { name: '说明', sel: '.aichat-help' },
];
for (const t of TABS) {
  await p.getByRole('tab', { name: new RegExp(t.name) }).click({ force: true });
  await p.waitForTimeout(350);
  const n = await p.locator(t.sel).count();
  ok(n === 1, `「${t.name}」tab 铺开（${t.sel} ×${n}）`);
}

// ---------- ④ 空态用同一颗 Empty ----------
await p.getByRole('tab', { name: /历史会话/ }).click({ force: true });
await p.waitForTimeout(300);
{
  const empty = await p.locator('.aichat-history .empty').count();
  ok(empty === 1, `历史会话空态是 .empty（实际 ${empty}）`);
}
await p.getByRole('tab', { name: /成果/ }).click({ force: true });
await p.waitForTimeout(300);
{
  const empty = await p.locator('.aichat-snaps .empty').count();
  ok(empty === 1, `成果空态是 .empty（实际 ${empty}）`);
}

// ---------- ② ③ 聊天区打字 + 切 tab 不丢 ----------
await p.getByRole('tab', { name: /聊天/ }).click({ force: true });
await p.waitForTimeout(300);
const box = p.locator('.aichat-input-row textarea');
await box.fill('第一行');
await box.press('Enter');
await p.waitForTimeout(150);
{
  const v = await box.inputValue();
  ok(v.includes('\n'), `Enter 只换行（值里带换行：${JSON.stringify(v)}）`);
}
await box.fill('测试一下输入还在不在');
await p.getByRole('tab', { name: /成果/ }).click({ force: true });
await p.waitForTimeout(300);
await p.getByRole('tab', { name: /聊天/ }).click({ force: true });
await p.waitForTimeout(300);
{
  const v = await p.locator('.aichat-input-row textarea').inputValue();
  ok(v === '测试一下输入还在不在', `切走再切回来输入还在（「${v}」）`);
}
// 发送键：没配模型时应当禁用，别让人白点
{
  const disabled = await p.locator('.aichat-send').isDisabled();
  console.log(`  · 发送键当前 ${disabled ? '禁用（无可用模型，符合预期）' : '可用'}`);
}

await backToNav();
await backToNav();

console.log(`\n  断言失败数：${failed}；控制台错误数：${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('    ! ' + e);

await browser.close();
const clean = failed === 0 && errors.length === 0;
console.log(clean ? '\n全部通过 ✓' : '\n有失败项 ✗');
process.exit(clean ? 0 : 1);
