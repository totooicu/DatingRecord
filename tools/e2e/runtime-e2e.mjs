// 服务 / 任务 两层体系 e2e。
//
// 验证：
//   R1  AI 聊天进行中离开页面 → head 出 AI 任务图标（进行中）→ 完成后变绿 →
//       点图标跳回 AI 对话且回复完好（证明离开页面没中断执行）→ 通知消失
//   R2  点击「进行中」任务也跳转，但图标不消失
//   R3  head 的「服务」「任务」入口能打开对应页面
//   R4  背景音乐自启动：开启后刷新，head 出现音乐服务图标（运行中）
//   R5  点击音乐服务图标跳到音乐页
//   R6  AI 轮次失败：head 图标变红（error），点开后通知消失
//   R7  默认不开自启动：新装打开 head 无服务图标、服务页开关为关
//   R8  任务页：完成后列出任务（标题改为已完成）→ 打开跳来源页 → 手动清除
//   R9  面板播放/暂停直接驱动服务运行态：播 → head 出图标，停 → 图标消失
//
// 依赖：fake-ai-matrix.mjs（含「慢慢」慢响应场景 + 「失败」500 场景）+ vite preview。
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

/** 进音乐面板（不上传）。设置页会记得上次打开的子页，可能直接就停在音乐面板 */
const openMusic = async (p) => {
  if (await p.locator('.music-panel').count()) return;
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.waitForTimeout(600);
  if (await p.locator('.music-panel').count()) return;
  await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: '音乐' }).first().click();
  await p.waitForTimeout(900);
};

/** 进音乐面板并上传一首测试音频（自启动场景的前置：没歌可放时服务开不了机） */
const goMusicUpload = async (p) => {
  await openMusic(p);
  // 音乐上传框（audio/*）和歌单导入框（.drpl）都是 file input：按 accept 区分
  await p.locator('input[accept="audio/*"]').setInputFiles('/tmp/tone.wav');
  await p.waitForTimeout(1500);
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
    .locator('.hs-task')
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check('R1：离开聊天页后 head 出现 AI 任务图标', sawRunning);
  const runningNow = await p.locator('.hs-task.running').count();
  check('R1：离开瞬间 AI 仍是「进行中」态', runningNow >= 1, `running 图标数=${runningNow}`);

  // 等它跑完 → 变绿（success）
  const sawSuccess = await p
    .locator('.hs-task.success')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check('R1：AI 完成后 head 图标变色（success）', sawSuccess);

  // 点图标 → 跳回 AI 对话页，且回复完好（创建了人物「小明」）
  await p.locator('.hs-task').first().click();
  await p.waitForTimeout(1500);
  const onChat = await p.locator('.aichat-tabs').count();
  check('R1：点图标跳回 AI 对话页', onChat >= 1);
  const body = await p.evaluate(() => document.body.innerText);
  check('R1：离开期间 AI 真的跑完了（回复提到新建人物）', body.includes('小明'), body.slice(0, 80));

  // 通知已读：回到主页 head，AI 图标应消失
  await goHome(p);
  await p.waitForTimeout(800);
  const stillThere = await p.locator('.hs-task').count();
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
  await p.locator('.aichat-input textarea').fill('慢慢新增第三个测试人物小刚');
  await p.locator('.aichat-send').click();

  // 趁进行中，先点返回键回到 AI 目录页（模拟「退出聊天页面」落到别的页）
  await p.waitForTimeout(900);
  await p.locator('.page-head .back-btn').first().click();
  await p.waitForTimeout(500);
  // 目录页 head 上应能看到进行中的 AI 任务图标
  const iconOnHub = await p.locator('.page-head-right .hs-task.running').count();
  check('R2：退出聊天到 AI 目录页后 head 显示进行中图标', iconOnHub >= 1, `count=${iconOnHub}`);

  // 点进行中图标 → 跳回 AI 对话（进行中不清通知）
  const clicked = await p
    .locator('.page-head-right .hs-task.running')
    .first()
    .click({ force: true })
    .then(() => true)
    .catch(() => false);
  check('R2：能点到进行中的任务图标', clicked);
  if (clicked) {
    // 点完立刻验证跳转（慢场景全程约 3.6s，这些等待要短，抢在完成前）
    await p.waitForTimeout(400);
    const onChat = await p.locator('.aichat-tabs').count();
    check('R2：点击进行中任务跳回 AI 对话', onChat >= 1);
    // 此刻任务还在跑：回主页，head 图标必须还在（点进行中不清通知）
    await goHome(p);
    await p.waitForTimeout(300);
    const runningStill = await p.locator('.hs-task.running').count();
    check('R2：进行中任务点过之后图标不消失', runningStill >= 1, `running=${runningStill}`);
    // 兜底：点过之后任务不受影响，继续跑完并变色
    const done = await p
      .waitForSelector('.hs-task.success', { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    check('R2：点过之后任务继续跑完并变色', done);
  }
  await p.context().close();
});

// ---- R3：head 的「服务」「任务」入口打开对应页面 ----
await scenario('R3 服务/任务入口页可达', async () => {
  const p = await newPage(browser);
  await boot(p);
  await goHome(p);

  await p.locator('.hs-text', { hasText: '服务' }).click();
  await p.waitForTimeout(700);
  const svcTitle = await p.getByText('背景音乐').count();
  const autoBox = await p.locator('.svc-auto input[type=checkbox]').count();
  check('R3：服务页打开且列出「背景音乐」+ 自启动开关', svcTitle >= 1 && autoBox >= 1);

  // 返回，再开任务页
  await p.locator('.page-head .back-btn').click();
  await p.waitForTimeout(500);
  await p.locator('.hs-text', { hasText: '任务' }).click();
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

  // 先传一首歌：自启动恢复时没歌可放，服务会保持已停止
  await goMusicUpload(p);
  await goHome(p);

  // 打开服务页，开启自启动
  await p.locator('.hs-text', { hasText: '服务' }).click();
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
    .locator('.hs-svc.running')
    .first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check('R4：开启自启动并刷新后 head 出现音乐服务图标（运行中）', svcIcon);
  const lsFlag = await p.evaluate(() => localStorage.getItem('dr.svc.autostart'));
  check('R4：自启动开关已持久化到统一存档', !!lsFlag && lsFlag.includes('music'), `localStorage=${lsFlag}`);

  // 点服务图标 → 跳到音乐页
  await p.locator('.hs-svc').first().click();
  await p.waitForTimeout(1000);
  const onMusic = await p.locator('.music-panel').count();
  check('R5：点服务图标跳到音乐页', onMusic >= 1);
  await p.context().close();
});

// ---- R6：AI 轮次失败 → 图标变红 → 点开清通知 ----
await scenario('R6 失败任务红色图标 + 点开清通知', async () => {
  const p = await newPage(browser);
  await boot(p);
  await setupModel(p);

  await ensureAiPage(p);
  await p.locator('.aichat-tab', { hasText: '聊天' }).click();
  await p.waitForTimeout(400);
  await p.locator('.aichat-input textarea').fill('失败测试：这一轮故意出错');
  await p.locator('.aichat-send').click();

  // 假服务对这一轮直接回 500：head 图标应变红（error），页面给出错误说明
  const redOnChat = await p
    .locator('.page-head-right .hs-task.error')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check('R6：AI 轮次失败后 head 图标变红', redOnChat);
  const errShown = await p.locator('.aichat-err').count();
  check('R6：聊天页显示错误说明', errShown >= 1);

  // 回主页：红色未读图标在，点它跳回聊天并清通知
  await goHome(p);
  await p.waitForTimeout(600);
  const redOnHome = await p.locator('.hs-task.error').count();
  check('R6：主页 head 出现红色未读图标', redOnHome >= 1, `count=${redOnHome}`);
  await p.locator('.hs-task.error').first().click();
  await p.waitForTimeout(900);
  const onChat = await p.locator('.aichat-tabs').count();
  check('R6：点红色图标跳回 AI 对话', onChat >= 1);
  await goHome(p);
  await p.waitForTimeout(600);
  const stillThere = await p.locator('.hs-task').count();
  check('R6：点开来源页后红色通知消失', stillThere === 0, `hs-task 数=${stillThere}`);
  await p.context().close();
});

// ---- R7：默认不开自启动 ----
await scenario('R7 默认不自启动', async () => {
  const p = await newPage(browser);
  await boot(p);
  await goHome(p);
  await p.waitForTimeout(600);

  // 全新环境（localStorage 无标记）：head 不应出现音乐服务图标
  const svcIcon = await p.locator('.hs-svc').count();
  check('R7：默认不开自启动时 head 无服务图标', svcIcon === 0, `count=${svcIcon}`);
  const lsFlag = await p.evaluate(() => localStorage.getItem('dr.svc.autostart'));
  check('R7：默认无自启动标记', lsFlag === null, `localStorage=${lsFlag}`);

  // 服务页里自启动开关应为未勾选
  await p.locator('.hs-text', { hasText: '服务' }).click();
  await p.waitForTimeout(700);
  const box = p.locator('.svc-auto input[type=checkbox]').first();
  const checked = await box.isChecked().catch(() => false);
  check('R7：服务页自启动开关默认关闭', !checked);
  const sub = await p.locator('.svc-row .svc-sub').first().textContent().catch(() => '');
  check('R7：服务页显示「已停止」', String(sub).includes('已停止'), `sub=${sub}`);
  await p.context().close();
});

// ---- R8：任务页（列出 → 打开跳转 → 清除） ----
await scenario('R8 任务页跳转与清除', async () => {
  const p = await newPage(browser);
  await boot(p);
  await setupModel(p);

  await ensureAiPage(p);
  await p.locator('.aichat-tab', { hasText: '聊天' }).click();
  await p.waitForTimeout(400);
  await p.locator('.aichat-input textarea').fill('新增一个人物小赵');
  await p.locator('.aichat-send').click();

  // 等这一轮跑完（快场景）
  const okIcon = await p
    .locator('.page-head-right .hs-task.success')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check('R8：AI 轮次完成', okIcon);

  // 打开任务页：应列出这条任务，标题是「AI 已完成回复」
  await goHome(p);
  await p.locator('.hs-text', { hasText: '任务' }).click();
  await p.waitForTimeout(700);
  const rows = await p.locator('.task-row').count();
  check('R8：任务页列出 1 条任务', rows === 1, `rows=${rows}`);
  const doneTitle = await p.getByText('AI 已完成回复').count();
  check('R8：完成后标题改为「AI 已完成回复」', doneTitle >= 1);

  // 点「打开」→ 跳回 AI 对话
  await p.locator('.task-open').first().click();
  await p.waitForTimeout(900);
  const onChat = await p.locator('.aichat-tabs').count();
  check('R8：任务页点打开跳回 AI 对话', onChat >= 1);

  // 再进任务页，手动清除
  await goHome(p);
  await p.locator('.hs-text', { hasText: '任务' }).click();
  await p.waitForTimeout(700);
  await p.locator('.task-clear').first().click();
  await p.waitForTimeout(500);
  const rowsAfter = await p.locator('.task-row').count();
  check('R8：手动清除后任务页为空', rowsAfter === 0, `rows=${rowsAfter}`);
  await p.context().close();
});

// ---- R9：面板播放/暂停直接驱动服务运行态（不碰自启动） ----
await scenario('R9 面板播放 → 服务图标跟着走', async () => {
  const p = await newPage(browser);
  await boot(p);
  await goHome(p);
  await goMusicUpload(p);
  await goHome(p);

  // 上传后没播：自启动没开，head 不该有服务图标
  const before = await p.locator('.hs-svc').count();
  check('R9：上传后未播放时 head 无服务图标', before === 0, `count=${before}`);

  // 回音乐页点播放 → head 出现运行中图标（服务状态跟着播放走，不停在「已停止」）
  await openMusic(p);
  await p.locator('.music-btn-play').click();
  await p.waitForTimeout(900);
  const playing = await p.locator('.music-title').textContent().catch(() => '');
  check('R9：点击后面板显示在播放', String(playing).includes('tone.wav'), `title=${playing}`);
  await goHome(p);
  await p.waitForTimeout(500);
  const whilePlay = await p.locator('.hs-svc.running').count();
  check('R9：播放中 head 出现音乐服务图标', whilePlay >= 1, `count=${whilePlay}`);
  const tip = await p.locator('.hs-svc').first().getAttribute('title').catch(() => '');
  check('R9：图标标题是当前曲目', String(tip).includes('tone.wav'), `title=${tip}`);

  // 回音乐页暂停 → 图标消失
  await openMusic(p);
  await p.locator('.music-btn-play').click();
  await p.waitForTimeout(600);
  await goHome(p);
  await p.waitForTimeout(500);
  const afterPause = await p.locator('.hs-svc').count();
  check('R9：暂停后 head 服务图标消失', afterPause === 0, `count=${afterPause}`);
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
