// 服务 / 任务 两层体系 e2e。
//
// 验证：
//   R1  AI 聊天进行中离开页面 → head 出 AI 任务图标（进行中）→ 完成后变绿 →
//       点图标跳回 AI 对话且回复完好（证明离开页面没中断执行）→ 通知消失
//   R2  点击「进行中」任务也跳转，但图标不消失
//   R3  head 的「服务」「任务」入口能打开对应页面
//   R4  背景音乐自启动：开启后刷新，head 出现音乐服务图标（运行中）
//   R5  点击音乐服务图标跳到音乐页
//
// 依赖：fake-ai-matrix.mjs（含「慢慢」慢响应场景）+ vite preview。
// 用法：node tools/e2e/runtime-e2e.mjs [url]

import { chromium } from '/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs';

const APP = process.argv[2] || 'http://localhost:4173/';
const FAKE = process.env.FAKE ?? 'http://localhost:8794/v1';

const failures = [];
const check = (label, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
    failures.push(label);
  }
};

const newPage = async (browser) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    console.log('[console/error]', m.text().slice(0, 200));
  });
  p.on('dialog', (d) => d.accept());
  return p;
};

const boot = async (p) => {
  await p.goto(APP, { waitUntil: 'load' });
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );
  const hasSeed = await p.getByText('载入示例数据看看效果').count();
  if (hasSeed) {
    await p.getByText('载入示例数据看看效果').click();
    await p.waitForTimeout(3000);
  }
};

const toSettingsRoot = async (p) => {
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

const setupModel = async (p) => {
  await toSettingsRoot(p);
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
};

const ensureAiPage = async (p) => {
  if (await p.locator('.aichat-tabs').count()) return;
  await toSettingsRoot(p);
  await p.locator('.settings-nav-title', { hasText: /^AI$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: /^AI 对话$/ }).click();
  await p.waitForTimeout(700);
};

const goHome = async (p) => {
  await p.locator('.tabbar-item', { hasText: '人物' }).click();
  await p.waitForTimeout(600);
};

const scenario = async (name, fn) => {
  console.log(`\n=== ${name} ===`);
  try {
    await fn();
  } catch (e) {
    console.log(`  ✗ 场景异常：${String(e).slice(0, 600)}`);
    failures.push(`${name}: 异常`);
  }
};

const browser = await chromium.launch();

// ---- R1：AI 进行中离开页面，head 出图标，完成后变色，点回且回复完好 ----
await scenario('R1 AI 后台任务 + 离开页面', async () => {
  const p = await newPage(browser);
  await boot(p);
  await setupModel(p);

  // 发一条「慢慢」消息让 AI 真正进行一段时间
  await ensureAiPage(p);
  await p.locator('.aichat-tab', { hasText: '聊天' }).click();
  await p.waitForTimeout(400);
  await p.locator('.aichat-input textarea').fill('慢慢新增一个测试人物小明');
  await p.locator('.aichat-send').click();

  // 立刻离开聊天页（点底部「人物」），AI 应在后台继续
  await p.waitForTimeout(800);
  await goHome(p);

  // head 上应该出现 AI 任务图标（进行中或已完成）
  const sawRunning = await p
    .locator('.home-head .hs-task')
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check('R1：离开聊天页后 head 出现 AI 任务图标', sawRunning);
  const runningNow = await p.locator('.home-head .hs-task.running').count();
  check('R1：离开瞬间 AI 仍是「进行中」态', runningNow >= 1, `running 图标数=${runningNow}`);

  // 等它跑完 → 变绿（success）
  const sawSuccess = await p
    .locator('.home-head .hs-task.success')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check('R1：AI 完成后 head 图标变色（success）', sawSuccess);

  // 点图标 → 跳回 AI 对话页，且回复完好（创建了人物「小明」）
  await p.locator('.home-head .hs-task').first().click();
  await p.waitForTimeout(1500);
  const onChat = await p.locator('.aichat-tabs').count();
  check('R1：点图标跳回 AI 对话页', onChat >= 1);
  const body = await p.evaluate(() => document.body.innerText);
  check('R1：离开期间 AI 真的跑完了（回复提到新建人物）', body.includes('小明'), body.slice(0, 80));

  // 通知已读：回到主页 head，AI 图标应消失
  await goHome(p);
  await p.waitForTimeout(800);
  const stillThere = await p.locator('.home-head .hs-task').count();
  check('R1：点开来源页后未读通知消失', stillThere === 0, `head 上 hs-task 数=${stillThere}`);
  await p.context().close();
});

// ---- R2：点击「进行中」任务也跳转，但图标不消失 ----
await scenario('R2 进行中任务点击只跳不清', async () => {
  const p = await newPage(browser);
  await boot(p);
  await setupModel(p);

  await ensureAiPage(p);
  await p.locator('.aichat-tab', { hasText: '聊天' }).click();
  await p.waitForTimeout(400);
  await p.locator('.aichat-input textarea').fill('慢慢新增第二个测试人物小红');
  await p.locator('.aichat-send').click();

  // 趁进行中点 head 上的进行中图标 → 跳转 AI 对话，但图标不消失
  await p.waitForTimeout(900);
  const clicked = await p
    .locator('.home-head .hs-task.running')
    .first()
    .click()
    .then(() => true)
    .catch(() => false);
  check('R2：能点到进行中的任务图标', clicked);
  if (clicked) {
    await p.waitForTimeout(1200);
    const onChat = await p.locator('.aichat-tabs').count();
    check('R2：点击进行中任务跳回 AI 对话', onChat >= 1);
    // 还没完成，回到主页 head 图标仍在（running）
    await goHome(p);
    await p.waitForTimeout(600);
    const runningStill = await p.locator('.home-head .hs-task.running').count();
    check('R2：进行中任务点过之后图标不消失', runningStill >= 1, `running=${runningStill}`);
  }
  await p.context().close();
});

// ---- R3：head 的「服务」「任务」入口打开对应页面 ----
await scenario('R3 服务/任务入口页可达', async () => {
  const p = await newPage(browser);
  await boot(p);
  await goHome(p);

  await p.locator('.home-head .hs-text', { hasText: '服务' }).click();
  await p.waitForTimeout(700);
  const svcTitle = await p.getByText('背景音乐').count();
  const autoBox = await p.locator('.svc-auto input[type=checkbox]').count();
  check('R3：服务页打开且列出「背景音乐」+ 自启动开关', svcTitle >= 1 && autoBox >= 1);

  // 返回，再开任务页
  await p.locator('.page-head .back-btn').click();
  await p.waitForTimeout(500);
  await p.locator('.home-head .hs-text', { hasText: '任务' }).click();
  await p.waitForTimeout(700);
  const taskTitle = await p.getByText('任务').count();
  check('R3：任务页打开', taskTitle >= 1);
  await p.context().close();
});

// ---- R4 + R5：背景音乐自启动，刷新后 head 出服务图标；点图标跳音乐页 ----
await scenario('R4/R5 音乐自启动 + 服务图标', async () => {
  const p = await newPage(browser);
  await boot(p);
  await goHome(p);

  // 打开服务页，开启自启动
  await p.locator('.home-head .hs-text', { hasText: '服务' }).click();
  await p.waitForTimeout(700);
  await p.locator('.svc-auto input[type=checkbox]').first().check();
  await p.waitForTimeout(500);

  // 刷新（重载应用）后，自启动应让音乐服务进入「运行中」，head 出现服务图标
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );
  await p.waitForTimeout(1500);
  const svcIcon = await p
    .locator('.home-head .hs-svc.running')
    .first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check('R4：开启自启动并刷新后 head 出现音乐服务图标（运行中）', svcIcon);
  const lsFlag = await p.evaluate(() => localStorage.getItem('music-autostart'));
  check('R4：自启动开关已持久化', lsFlag === '1', `localStorage=${lsFlag}`);

  // 点服务图标 → 跳到音乐页
  await p.locator('.home-head .hs-svc').first().click();
  await p.waitForTimeout(1000);
  const onMusic = await p.locator('.music-panel').count();
  check('R5：点服务图标跳到音乐页', onMusic >= 1);
  await p.context().close();
});

await browser.close();

console.log('\n========== 汇总 ==========');
if (failures.length) {
  console.log(`${failures.length} 项失败：`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('全部通过 ✓');
process.exit(0);
