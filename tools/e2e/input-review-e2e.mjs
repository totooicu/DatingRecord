// 验证两项需求（基于远端已合并的「审核后执行」机制）：
//   需求1: AI 对话框 Enter 只换行、不发送；Cmd/Ctrl+Enter 才发送。
//   需求3: AI 跑完后改动先「挂起」，点「执行」前真实人物列表看不到 P1，
//          点「执行」后看得到 P1（改动这才落地）。
//
// 用法：
//   node tools/e2e/fake-ai-flow.mjs                 # 另开终端，假模型服务（默认 8791）
//   npx vite preview --port 4173                    # 生产构建服务
//   FAKE=http://localhost:8791/v1 node tools/e2e/input-review-e2e.mjs [url]

import { chromium } from '/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs';

const APP = process.argv[2] || 'http://localhost:4173/';
const FAKE = process.env.FAKE ?? 'http://localhost:8791/v1';

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));
p.on('console', async (m) => {
  if (m.type() !== 'error' && m.type() !== 'warning') return;
  const loc = m.location();
  console.log(`[console/${m.type()}]`, m.text().slice(0, 400));
  if (loc?.url) console.log(`    at ${loc.url}:${loc.lineNumber}:${loc.columnNumber}`);
});
p.on('dialog', (d) => d.accept()); // 「执行 / 放弃 / 接受」的 confirm 自动接受

let failed = false;
const step = async (label, fn) => {
  process.stdout.write(`· ${label} … `);
  try {
    await fn();
    console.log('ok');
  } catch (e) {
    failed = true;
    console.log('FAIL:', String(e).slice(0, 240));
  }
};
const gotoPersons = async () => {
  await p.locator('.tabbar-item', { hasText: '人物' }).first().click();
  await p.waitForTimeout(1200);
};
const personsText = () =>
  p.evaluate(() => (document.querySelector('.page-persons') ?? document.body).innerText ?? '');
const closeModal = async () => {
  await p.locator('.modal-head .icon-btn').first().click().catch(() => {});
  await p.waitForTimeout(500);
};
/**
 * 回到设置目录一级页。子页激活时左侧目录被 CSS 整个藏掉，页头换成 ‹ 返回键，
 * 而且点底部 tab「设置」不会重置子页状态——所以必须先一路点返回键爬回目录。
 * 最多三层：AI 对话 → AI → 目录。
 */
const toSettingsRoot = async () => {
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.waitForTimeout(500);
  for (let i = 0; i < 3; i++) {
    const back = p.locator('.page-head .back-btn');
    if (!(await back.count())) break;
    if (!(await back.first().isVisible().catch(() => false))) break;
    await back.first().click().catch(() => {});
    await p.waitForTimeout(400);
  }
};

await step('打开并载入示例数据', async () => {
  await p.goto(APP, { waitUntil: 'load' });
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );
  if (await p.getByText('载入示例数据看看效果').count()) {
    await p.getByText('载入示例数据看看效果').click();
    await p.waitForTimeout(3000);
  }
});

await step('进 AI 对话页并配假模型', async () => {
  await toSettingsRoot();
  await p.locator('.settings-nav-title', { hasText: /^AI$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: /^模型$/ }).click();
  await p.waitForTimeout(700);
  await p.getByRole('button', { name: '添加模型' }).click();
  await p.waitForTimeout(400);
  await p.locator('.field', { hasText: '别名' }).locator('input').fill('e2e');
  const prov = p.locator('.field', { hasText: '服务商' }).locator('select');
  if (await prov.count()) await prov.selectOption('openai');
  await p.waitForTimeout(200);
  const base = p.locator('.field', { hasText: 'API 根地址' }).locator('input');
  if (await base.count()) await base.fill(FAKE);
  await p.locator('.field', { hasText: '模型名' }).locator('input').fill('fake-gpt');
  const key = p.locator('.field', { hasText: 'API 密钥' }).locator('input');
  if (await key.count()) await key.fill('sk-e2e');
  await p.getByRole('button', { name: '保存' }).first().click();
  await p.waitForTimeout(800);
});

// ===== 需求1：Enter 只换行不发送；Cmd/Ctrl+Enter 才发送 =====
await step('需求1: Enter 换行但不发送', async () => {
  // 模型配置是独立子页，先回 AI 对话页
  await toSettingsRoot();
  await p.locator('.settings-nav-title', { hasText: /^AI$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: /^AI 对话$/ }).click();
  await p.waitForTimeout(700);
  await p.locator('.aichat-tab', { hasText: '聊天' }).click();
  await p.waitForTimeout(400);
  const ta = p.locator('.aichat-input textarea');
  await ta.click();
  await ta.pressSequentially('第一行');
  await ta.press('Enter'); // 只换行
  await ta.pressSequentially('第二行');
  await p.waitForTimeout(300);
  const val = await ta.inputValue();
  if (!val.includes('\n')) throw new Error('Enter 没产生换行：' + JSON.stringify(val));
  // 没发送：输入框还在、没出现「AI 干活中」
  if (await p.locator('.aichat-busy-chip').count()) throw new Error('Enter 竟然触发了发送（出现 busy）');
  const busy = await p.locator('.aichat-send').isDisabled().catch(() => false);
  console.log('  → textarea=', JSON.stringify(val), 'busy-disabled=', busy);
});

await step('需求1: Cmd/Ctrl+Enter 才发送', async () => {
  const ta = p.locator('.aichat-input textarea');
  await ta.press('Control+Enter');
  // 发送后 AI 开始干活：要么出现 busy，要么输入框被清空
  await p.waitForSelector('.aichat-busy-chip', { timeout: 15000 }).catch(() => {});
  const sent = (await p.locator('.aichat-busy-chip').count()) > 0 || (await ta.inputValue()) === '';
  if (!sent) throw new Error('Ctrl+Enter 没有触发发送');
  console.log('  → 已发送，AI 进入干活状态');
  await p.waitForSelector('.aichat-busy-chip', { state: 'detached', timeout: 180000 });
  await p.waitForTimeout(1200);
});

// ===== 需求3：审阅后执行，P1 执行前不在真实库、执行后入库 =====
await step('需求3: 成果能看到 新增/修改/删除 三组', async () => {
  await p.locator('.aichat-tab', { hasText: '成果' }).click();
  await p.waitForTimeout(900);
  await p.locator('.aichat-snap-main').first().click();
  await p.waitForTimeout(1500);
  const heads = await p.evaluate(() =>
    [...document.querySelectorAll('.aichat-diff-head')].map((h) => h.textContent.trim()),
  );
  const joined = heads.join(' | ');
  if (!/新增/.test(joined) || !/修改/.test(joined) || !/删除/.test(joined)) {
    throw new Error('分组不全：' + joined);
  }
  console.log('  →', joined);
});

await step('需求3: 执行前真实人物列表看不到 P1', async () => {
  await closeModal();
  await gotoPersons();
  const txt = await personsText();
  if (txt.includes('P1')) throw new Error('P1 已出现在真实库——改动没挂起！');
});

await step('需求3: 点「执行」把改动落地', async () => {
  await toSettingsRoot();
  await p.locator('.settings-nav-title', { hasText: /^AI$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: /^AI 对话$/ }).click();
  await p.waitForTimeout(600);
  await p.locator('.aichat-tab', { hasText: '成果' }).click();
  await p.waitForTimeout(700);
  await p.locator('.aichat-snap-main').first().click();
  await p.waitForTimeout(1200);
  await p.locator('.modal').getByRole('button', { name: '执行' }).click();
  await p.waitForTimeout(1500);
});

await step('需求3: 执行后真实人物列表看得到 P1', async () => {
  await closeModal();
  await gotoPersons();
  const txt = await personsText();
  if (!txt.includes('P1')) throw new Error('P1 执行后仍未出现在真实库');
});

await b.close();
console.log(failed ? '\n结果：存在失败项 ✗' : '\n结果：需求1(换行不发送) + 需求3(审核后执行) 验证全部通过 ✓');
process.exit(failed ? 1 : 0);
