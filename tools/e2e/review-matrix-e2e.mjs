// 矩阵 e2e：多变种 AI 操作 × 三个时间点的数据核对。
//
// 每个场景独立浏览器上下文（干净 IndexedDB + 示例数据），核对：
//   T1 AI 动手前 → T2 跑完暂存（待执行） → T3 点「执行」之后
// 核心不变量：T2 时真实库必须还是 T1 的样子（AI 的改动没落地）；
// T3 之后真实库必须变成 AI 改完的样子。撤销 / 放弃 / 刷新都不能破坏这条线。
//
// 场景清单：
//   S1  纯新增：三个目标 T2 看不到、T3 看得到
//   S2  纯修改：T2 时间线是旧标题，T3 是新标题，人物备注随之更新
//   S3  纯删除：T2 被删对象还在列表，T3 消失（进回收站）
//   S4  建了又删：净变化为零，详情显示「动过又复原」，库里自始至终没有它
//   S5  无改动：不调写工具就不出成果卡，库无变化
//   S6a pending 后连按撤销：改动不会被放回真实库
//   S6b 执行后连按撤销：已落地的成果不会被撤掉
//   S7  放弃：成果消失、库无变化、撤销也放不回来
//   S8  刷新页面：pending 不丢，刷新后仍能执行落地
//   S9  多 pending 拦截：第一条没处理时第二条发不出去
//   S10 混合：新增/修改/删除/净零 四组同堂，逐组核对
//   S11 已执行后「放弃改动」：整轮回退，自动留底
//   S12 暂存期间数据被外人动过（合并导入）：执行被拦截，放弃后外部改动完好
//
// 用法：
//   PORT=8794 node tools/e2e/fake-ai-matrix.mjs   # 假模型服务
//   npx vite preview --port 4173                  # 或 dev :5173
//   node tools/e2e/review-matrix-e2e.mjs [url]
//
// 导航注意：设置页带子页的入口（AI / 备份与分享 / 功能体验）在子页激活时，
// 左侧目录被 CSS 整个藏掉、页头换成 ‹ 返回键，且点底部 tab「设置」不会
// 重置子页状态——所以每次要进目录都先走 toSettingsRoot() 点返回键爬回去，
// 直接点 .settings-nav-title 会等到超时（元素在 DOM 里但不可见）。

import { chromium } from '/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs';

const APP = process.argv[2] || 'http://localhost:4173/';
const FAKE = process.env.FAKE ?? 'http://localhost:8794/v1';

const failures = [];
const check = (label, cond, extra = '') => {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
    failures.push(label);
  }
};
const has = (text, sub) => String(text).includes(sub);

// ---------------- 公共助手 ----------------

const newPage = async (browser) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));
  p.on('console', async (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const loc = m.location();
    console.log(`[console/${m.type()}]`, m.text().slice(0, 300));
    if (loc?.url) console.log(`    at ${loc.url}:${loc.lineNumber}:${loc.columnNumber}`);
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

/**
 * 回到设置目录一级页。子页激活时左侧目录被 CSS 整个藏掉，页头换成 ‹ 返回键，
 * 而且点底部 tab「设置」不会重置子页状态——所以必须先一路点返回键爬回目录。
 * 最多三层：AI 对话 → AI → 目录。
 */
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

/** 确保当前停在 AI 对话页（底部 tab 的 section 状态会保留，探测一下更稳） */
const ensureAiPage = async (p) => {
  if (await p.locator('.aichat-tabs').count()) return;
  await toSettingsRoot(p);
  await p.locator('.settings-nav-title', { hasText: /^AI$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: /^AI 对话$/ }).click();
  await p.waitForTimeout(700);
};

const send = async (p, text) => {
  await ensureAiPage(p);
  await p.locator('.aichat-tab', { hasText: '聊天' }).click();
  await p.waitForTimeout(400);
  await p.locator('.aichat-input textarea').fill(text);
  await p.locator('.aichat-send').click();
  await p.waitForSelector('.aichat-busy-chip', { state: 'detached', timeout: 180000 });
  await p.waitForTimeout(1500);
};

/** 读真实库的三个列表页文本——T1/T2/T3 都靠它比对 */
const libText = async (p) => {
  await p.locator('.tabbar-item', { hasText: '人物' }).click();
  await p.waitForTimeout(500);
  const persons = await p.evaluate(() => document.body.innerText);
  await p.locator('.tabbar-item', { hasText: '事件集' }).click();
  await p.waitForTimeout(500);
  const collections = await p.evaluate(() => document.body.innerText);
  await p.locator('.tabbar-item', { hasText: '时间线' }).click();
  await p.waitForTimeout(500);
  const events = await p.evaluate(() => document.body.innerText);
  return { persons, collections, events };
};

const gotoSnaps = async (p) => {
  await ensureAiPage(p);
  await p.locator('.aichat-tab', { hasText: '成果' }).click();
  await p.waitForTimeout(900);
};

const snapList = async (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll('.aichat-snap-list li')].map((li) => ({
      title: li.querySelector('.aichat-snap-title')?.textContent?.trim() ?? '',
      status: li.querySelector('.aichat-snap-status')?.textContent?.trim() ?? '',
      chips: [...li.querySelectorAll('.aichat-target-name')].map((x) => x.textContent.trim()),
    })),
  );

const openSnap = async (p, idx = 0) => {
  await p.locator('.aichat-snap-main').nth(idx).click();
  await p.waitForTimeout(1500);
  return p.evaluate(() => {
    const m = document.querySelector('.modal');
    if (!m) return { err: '没有弹窗' };
    return {
      title: m.querySelector('.aichat-snap-detail-title')?.textContent?.trim() ?? '',
      groups: [...m.querySelectorAll('.aichat-diff-group')].map((g) => ({
        head: g.querySelector('.aichat-diff-head')?.textContent?.trim() ?? '',
        items: [...g.querySelectorAll('.aichat-target-name')].map((x) => x.textContent.trim()),
      })),
      note: m.querySelector('.aichat-diff-note')?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
    };
  });
};

const closeSnap = async (p) => {
  await p.locator('.modal-head .icon-btn').first().click().catch(() => {});
  await p.waitForTimeout(500);
};

const snapBtn = (p, idx, cls) => p.locator('.aichat-snap-list li').nth(idx).locator(cls);
const execSnap = async (p, idx = 0) => {
  await snapBtn(p, idx, '.aichat-linkbtn-go').click();
  await p.waitForTimeout(2200);
};
const discardSnap = async (p, idx = 0) => {
  await snapBtn(p, idx, '.aichat-linkbtn-dim').click();
  await p.waitForTimeout(2200);
};

/** 连按两次 Ctrl+Z。焦点先在输入框里时浏览器只会撤销文本，先点空白移开 */
const ctrlZ = async (p) => {
  await p.locator('.aichat-subhead').first().click().catch(() => {});
  await p.waitForTimeout(200);
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(1000);
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(1200);
};

const scenario = async (browser, name, fn) => {
  console.log(`\n===== ${name} =====`);
  const p = await newPage(browser);
  try {
    await fn(p);
  } catch (e) {
    // 别截太短：Playwright 的 call log 才是定位点击超时的关键信息
    console.log(`  ✗ 场景异常：${String(e).slice(0, 3000)}`);
    failures.push(`${name}: 异常`);
  }
  await p.context().close();
};

// ---------------- 场景 ----------------

const b = await chromium.launch();

await scenario(b, 'S1 纯新增：T2 看不到、T3 看得到', async (p) => {
  await boot(p);
  await setupModel(p);
  const t0 = await libText(p);
  check(
    'T0 动手前：三个目标都不在库',
    !has(t0.persons, 'M-新人物') && !has(t0.events, 'M-新事件') && !has(t0.collections, 'M-新事件集'),
  );
  await send(p, '新增一批数据');
  await gotoSnaps(p);
  const list1 = await snapList(p);
  check('T2：有 1 条成果且「待执行」', list1.length === 1 && list1[0].status === '待执行', JSON.stringify(list1));
  const d1 = await openSnap(p);
  const created = d1.groups.find((g) => g.head.includes('新增'));
  check('T2：新增组 3 项（人物/事件/事件集）', created?.items.length === 3, JSON.stringify(d1.groups));
  await closeSnap(p);
  const t1 = await libText(p);
  check(
    'T2：真实库仍看不到三个目标（沙盘未落地）',
    !has(t1.persons, 'M-新人物') && !has(t1.events, 'M-新事件') && !has(t1.collections, 'M-新事件集'),
  );
  await gotoSnaps(p);
  await execSnap(p);
  const list2 = await snapList(p);
  check('T3：成果变「已执行」', list2.length === 1 && list2[0].status === '已执行', JSON.stringify(list2));
  const t2 = await libText(p);
  check(
    'T3：三个目标全部进库',
    has(t2.persons, 'M-新人物') && has(t2.events, 'M-新事件') && has(t2.collections, 'M-新事件集'),
  );
});

await scenario(b, 'S2 纯修改：T2 旧值、T3 新值', async (p) => {
  await boot(p);
  await setupModel(p);
  const t0 = await libText(p);
  check('T0：原标题在、新标题不在', has(t0.events, '日料晚餐') && !has(t0.events, '矩阵改过'));
  await send(p, '修改一些数据');
  await gotoSnaps(p);
  const list1 = await snapList(p);
  check('T2：1 条待执行', list1.length === 1 && list1[0].status === '待执行', JSON.stringify(list1));
  const d1 = await openSnap(p);
  const updated = d1.groups.find((g) => g.head.includes('修改'));
  check('T2：修改组 2 项（事件标题正文 + 人物备注）', updated?.items.length === 2, JSON.stringify(d1.groups));
  // pending 时点开修改组第一个（人物）：弹记录详情，detail 应是 AI 改后的值
  await p.locator('.aichat-diff-updated .aichat-target').first().click();
  await p.waitForTimeout(1200);
  const recDetail = await p.evaluate(() => document.querySelector('.aichat-record')?.innerText ?? '');
  check('T2：暂存详情显示改后的备注（detail 是改后值）', has(recDetail, '矩阵修改场景写入的新备注'), recDetail.slice(0, 100));
  await p.locator('.modal-head .icon-btn').last().click().catch(() => {});
  await p.waitForTimeout(400);
  await closeSnap(p);
  const t1 = await libText(p);
  check('T2：时间线仍是旧标题（改动没落地）', has(t1.events, '日料晚餐') && !has(t1.events, '矩阵改过'));
  await gotoSnaps(p);
  await execSnap(p);
  const t2 = await libText(p);
  check('T3：新标题进库', has(t2.events, '矩阵改过'));
});

await scenario(b, 'S3 纯删除：T2 还在、T3 消失', async (p) => {
  await boot(p);
  await setupModel(p);
  const t0 = await libText(p);
  check('T0：许知夏与示例事件都在', has(t0.persons, '许知夏') && has(t0.events, '第一次一起看电影'));
  await send(p, '删除一些数据');
  await gotoSnaps(p);
  const list1 = await snapList(p);
  check('T2：1 条待执行', list1.length === 1 && list1[0].status === '待执行', JSON.stringify(list1));
  const d1 = await openSnap(p);
  const deleted = d1.groups.find((g) => g.head.includes('删除'));
  check('T2：删除组 2 项', deleted?.items.length === 2, JSON.stringify(d1.groups));
  await closeSnap(p);
  const t1 = await libText(p);
  const names = deleted?.items ?? [];
  check(
    'T2：被删/归档对象在真实库还在（软删未落地）',
    names.length === 2 && names.every((n) => has(t1.persons, n) || has(t1.events, n) || has(t1.collections, n)),
    JSON.stringify(names),
  );
  await gotoSnaps(p);
  await execSnap(p);
  const t2 = await libText(p);
  check(
    'T3：两个对象从各自列表消失',
    names.every((n) => !has(t2.persons, n) && !has(t2.events, n) && !has(t2.collections, n)),
    JSON.stringify(names),
  );
  // 回收站里应该能找到它们（软删可恢复）。先爬回设置目录——子页里导航是藏着的
  await toSettingsRoot(p);
  await p.locator('.settings-nav-title', { hasText: /^归档与回收$/ }).click();
  await p.waitForTimeout(900);
  const archText = await p.evaluate(() => document.body.innerText);
  const inArchive = names.filter((n) => has(archText, n));
  check('T3：回收站里能找到被删/归档对象（软删可恢复）', inArchive.length === names.length, JSON.stringify({ inArchive, names }));
});

await scenario(b, 'S4 建了又删：净变化为零', async (p) => {
  await boot(p);
  await setupModel(p);
  await send(p, '建了又删试试');
  await gotoSnaps(p);
  const list1 = await snapList(p);
  check('T2：1 条待执行（字节变过就会暂存）', list1.length === 1 && list1[0].status === '待执行', JSON.stringify(list1));
  const d1 = await openSnap(p);
  const emptyGroups = (d1.groups ?? []).every((g) => g.items.length === 0);
  check('T2：增删改三组都空', emptyGroups, JSON.stringify(d1.groups));
  check('T2：详情显示「动过又复原」提示且点名 M-临时事件集', has(d1.note, '复原') && has(d1.note, 'M-临时事件集'), d1.note);
  await closeSnap(p);
  const t1 = await libText(p);
  check('T2：真实库无 M-临时事件集', !has(t1.collections, 'M-临时事件集'));
  await gotoSnaps(p);
  await execSnap(p);
  const t2 = await libText(p);
  check('T3：执行后库里仍然没有它', !has(t2.collections, 'M-临时事件集'));
});

await scenario(b, 'S5 无改动：不出成果、库不变', async (p) => {
  await boot(p);
  await setupModel(p);
  await send(p, '你好呀');
  await gotoSnaps(p);
  const list = await snapList(p);
  check('无成果卡', list.length === 0, JSON.stringify(list));
  const t = await libText(p);
  check('库无变化（示例数据还在）', has(t.persons, '林小满') && has(t.events, '认识的那天'));
});

await scenario(b, 'S6a pending 后连按撤销：改动放不回来', async (p) => {
  await boot(p);
  await setupModel(p);
  await send(p, '新增一批数据');
  await gotoSnaps(p);
  await openSnap(p);
  await closeSnap(p);
  await ctrlZ(p);
  const t = await libText(p);
  check('pending 后撤销，库里仍看不到 M-新人物', !has(t.persons, 'M-新人物'), has(t.persons, 'M-新人物') ? '改动被撤销放回来了！' : '');
});

await scenario(b, 'S6b 执行后连按撤销：成果撤不掉', async (p) => {
  await boot(p);
  await setupModel(p);
  await send(p, '新增一批数据');
  await gotoSnaps(p);
  await execSnap(p);
  const before = await libText(p);
  check('执行后 M-新人物在库', has(before.persons, 'M-新人物'));
  await gotoSnaps(p);
  await ctrlZ(p);
  const t = await libText(p);
  check('执行后撤销，M-新人物仍在库', has(t.persons, 'M-新人物'), has(t.persons, 'M-新人物') ? '' : '执行成果被撤掉了！');
});

await scenario(b, 'S7 放弃：库无变化、撤销也放不回', async (p) => {
  await boot(p);
  await setupModel(p);
  await send(p, '新增一批数据');
  await gotoSnaps(p);
  const list1 = await snapList(p);
  check('放弃前 1 条待执行', list1.length === 1 && list1[0].status === '待执行');
  await discardSnap(p);
  const list2 = await snapList(p);
  check('放弃后无成果卡', list2.length === 0, JSON.stringify(list2));
  await ctrlZ(p);
  const t = await libText(p);
  check('放弃后撤销也不会把改动放回', !has(t.persons, 'M-新人物'), has(t.persons, 'M-新人物') ? '改动被放回来了！' : '');
});

await scenario(b, 'S8 刷新页面：pending 不丢、仍能执行', async (p) => {
  await boot(p);
  await setupModel(p);
  await send(p, '新增一批数据');
  await gotoSnaps(p);
  const list1 = await snapList(p);
  check('刷新前 1 条待执行', list1.length === 1 && list1[0].status === '待执行');
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );
  await ensureAiPage(p);
  await p.locator('.aichat-tab', { hasText: '成果' }).click();
  await p.waitForTimeout(900);
  const list2 = await snapList(p);
  check('刷新后仍 1 条待执行', list2.length === 1 && list2[0].status === '待执行', JSON.stringify(list2));
  const t1 = await libText(p);
  check('刷新后真实库仍无 M-新人物', !has(t1.persons, 'M-新人物'));
  await gotoSnaps(p);
  await execSnap(p);
  const t2 = await libText(p);
  check('刷新后执行仍能落地', has(t2.persons, 'M-新人物'));
});

await scenario(b, 'S9 多 pending 拦截：没处理完不让发下一轮', async (p) => {
  await boot(p);
  await setupModel(p);
  await send(p, '新增一批数据');
  await gotoSnaps(p);
  const list1 = await snapList(p);
  check('第一条待执行', list1.length === 1 && list1[0].status === '待执行');
  await ensureAiPage(p);
  await p.locator('.aichat-tab', { hasText: '聊天' }).click();
  await p.waitForTimeout(400);
  await p.locator('.aichat-input textarea').fill('再新增一批');
  await p.locator('.aichat-send').click();
  await p.waitForTimeout(1500);
  const err = await p.locator('.aichat-err').textContent().catch(() => '');
  check('第二条被拦截并提示先处理', has(err, '还有一份成果没确认'), err);
  await gotoSnaps(p);
  const list2 = await snapList(p);
  check('仍只有 1 条待执行（没有第二份）', list2.length === 1 && list2[0].status === '待执行', JSON.stringify(list2));
});

await scenario(b, 'S10 混合：四组同堂逐组核对', async (p) => {
  await boot(p);
  await setupModel(p);
  await send(p, '混合操作来一遍');
  await gotoSnaps(p);
  const list1 = await snapList(p);
  check('T2：1 条待执行', list1.length === 1 && list1[0].status === '待执行', JSON.stringify(list1));
  const d1 = await openSnap(p);
  const created = d1.groups.find((g) => g.head.includes('新增'));
  const updated = d1.groups.find((g) => g.head.includes('修改'));
  const deleted = d1.groups.find((g) => g.head.includes('删除'));
  check('T2：新增 3（人物/事件/事件集）', created?.items.length === 3, JSON.stringify(d1.groups));
  check('T2：修改 2（事件标题 + 人物备注）', updated?.items.length === 2, JSON.stringify(d1.groups));
  check('T2：删除 2（1 事件 + 1 归档人物）', deleted?.items.length === 2, JSON.stringify(d1.groups));
  check('T2：reverted 提示点名 M-混合临时集', has(d1.note, 'M-混合临时集'), d1.note);
  await closeSnap(p);
  const t1 = await libText(p);
  check(
    'T2：真实库无任何混合新对象',
    !has(t1.persons, 'M-混合人物') && !has(t1.events, 'M-混合事件') && !has(t1.collections, 'M-混合事件集'),
  );
  check('T2：真实库事件标题未被改', !has(t1.events, '矩阵改过'));
  await gotoSnaps(p);
  await execSnap(p);
  const t2 = await libText(p);
  check(
    'T3：三个新对象全部落地',
    has(t2.persons, 'M-混合人物') && has(t2.events, 'M-混合事件') && has(t2.collections, 'M-混合事件集'),
  );
  check('T3：临时集没有落地（净零）', !has(t2.collections, 'M-混合临时集'));
  check('T3：事件标题修改生效', has(t2.events, '矩阵改过'));
});

await scenario(b, 'S11 已执行后「放弃改动」：整轮回退', async (p) => {
  await boot(p);
  await setupModel(p);
  await send(p, '新增一批数据');
  await gotoSnaps(p);
  await execSnap(p);
  const t2 = await libText(p);
  check('执行后 M-新人物在库', has(t2.persons, 'M-新人物'));
  await gotoSnaps(p);
  await snapBtn(p, 0, '.aichat-linkbtn-danger').click(); // 「放弃改动」= restoreSnapshot
  await p.waitForTimeout(2500);
  const t3 = await libText(p);
  check('放弃改动后 M-新人物从库消失', !has(t3.persons, 'M-新人物'), has(t3.persons, 'M-新人物') ? '回退没生效' : '');
  await gotoSnaps(p);
  const list = await snapList(p);
  check('S11：回退后列表保留记录（原成果 + auto 留底）', list.length >= 2, JSON.stringify(list.map((x) => x.title)));
});

await scenario(b, 'S12 暂存期间外部改动：执行被拦截、放弃后改动完好', async (p) => {
  await boot(p);
  await setupModel(p);
  await send(p, '新增一批数据');
  await gotoSnaps(p);
  const list1 = await snapList(p);
  check('暂存 1 条待执行', list1.length === 1 && list1[0].status === '待执行', JSON.stringify(list1));

  // 暂存期间做一次「合并导入」——往库里塞一个外部人物，模拟用户改数据 / 导备份
  const libFile = '/tmp/matrix-import.drp.json';
  await (await import('node:fs/promises')).writeFile(
    libFile,
    JSON.stringify({
      schemaVersion: 11,
      meta: { id: 'ext', name: '外部导入', exportedAt: new Date().toISOString(), app: 'e2e', deviceId: 'e2e' },
      attributeDefs: [],
      persons: [{ id: 'ext-1', displayName: 'M-外部人物', hlc: 'zzzzzzzzzz-e2e' }],
      attrHistory: [],
      events: [],
      collections: [],
      members: [],
    }),
  );
  await toSettingsRoot(p);
  await p.locator('.settings-nav-title', { hasText: /^备份与分享$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: /^数据备份$/ }).click();
  await p.waitForTimeout(700);
  await p.locator('input[type=file]').setInputFiles(libFile);
  await p.waitForSelector('.alert-ok', { timeout: 30000 });
  const impText = await p.locator('.alert-ok').textContent();
  check('合并导入成功', has(impText, '导入完成'), impText);
  const tExt = await libText(p);
  check('外部人物已进真实库（暂存期间的数据变化）', has(tExt.persons, 'M-外部人物'));

  // 回到成果点执行：应当被拦截，而不是把外部改动冲掉
  await gotoSnaps(p);
  await execSnap(p);
  const list2 = await snapList(p);
  check('执行被拦截：仍是待执行', list2.length === 1 && list2[0].status === '待执行', JSON.stringify(list2));
  const errText = await p.locator('.aichat-err').textContent().catch(() => '');
  check('拦截提示说明原因', has(errText, '执行已拦截') && has(errText, '被其他操作改过'), errText);

  // 放弃这轮：外部改动必须完好，AI 的改动不准混进来
  await discardSnap(p);
  const list3 = await snapList(p);
  check('放弃后无成果卡', list3.length === 0, JSON.stringify(list3));
  const tEnd = await libText(p);
  check('放弃后外部人物还在', has(tEnd.persons, 'M-外部人物'));
  check('放弃后 AI 的人物没进来', !has(tEnd.persons, 'M-新人物'));
});

await b.close();

console.log(`\n========== 汇总：${failures.length === 0 ? '全部通过 ✓' : `${failures.length} 项失败`} ==========`);
if (failures.length) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
