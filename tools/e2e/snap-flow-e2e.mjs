// 端到端跑一遍「AI 连续做很多操作」的流程，检查成果是不是：
//   1) 只有 1 条  2) 详情按 新增 / 修改 / 删除 分组
//   3) 「执行」之后能点开真实详情页  4) 已执行后能拒绝单条改动
//   5) 从详情页跳出去还能回成果
//
// 流程照「审核后执行」的语义排：AI 跑完先暂存（待执行）→ 核对分组 → 执行 →
// 落地后拒绝单项 → 点开真实对象 → 跳出去再回来。
//
// 用法：
//   node tools/e2e/fake-ai-flow.mjs        # 另开一个终端，假模型服务
//   npx vite --port 5173                   # dev 服务（或 preview :4173）
//   node tools/e2e/snap-flow-e2e.mjs [url]
//
// 依赖：全局 playwright + 上面的两个服务。手机视口（390×844）下跑，贴近真实使用。

import { chromium } from '/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs';

const APP = process.argv[2] || 'http://localhost:5173/';
const FAKE = process.env.FAKE ?? 'http://localhost:8791/v1';

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));
// 警告不是 error，但「渲染 A 时改 B」这类信号往往就是 bug 的苗头，一并抓下来
p.on('console', async (m) => {
  if (m.type() !== 'error' && m.type() !== 'warning') return;
  const loc = m.location();
  console.log(`[console/${m.type()}]`, m.text().slice(0, 400));
  if (loc?.url) console.log(`    at ${loc.url}:${loc.lineNumber}:${loc.columnNumber}`);
});
// 执行 / 放弃 / 拒绝都带 window.confirm，自动确认
p.on('dialog', (d) => d.accept());

const step = async (label, fn) => {
  process.stdout.write(`· ${label} … `);
  await fn();
  console.log('ok');
};

const dumpDetail = () =>
  p.evaluate(() => {
    const m = document.querySelector('.modal');
    if (!m) return { err: '没有弹窗' };
    return {
      title: m.querySelector('.aichat-snap-detail-title')?.textContent?.trim() ?? '',
      groups: [...m.querySelectorAll('.aichat-diff-group')].map((g) => ({
        head: g.querySelector('.aichat-diff-head')?.textContent?.trim() ?? '',
        items: [...g.querySelectorAll('.aichat-target-name')].map((x) => x.textContent.trim()),
      })),
      revertedNote: m.querySelector('.aichat-diff-note')?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
    };
  });

const snapList = () =>
  p.evaluate(() =>
    [...document.querySelectorAll('.aichat-snap-list li')].map((li) => ({
      title: li.querySelector('.aichat-snap-title')?.textContent?.trim() ?? '',
      status: li.querySelector('.aichat-snap-status')?.textContent?.trim() ?? '',
    })),
  );

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

/** 模型配置是「设置 → AI → 模型」独立子页，回对话页要重新导航 */
const ensureAiPage = async () => {
  if (await p.locator('.aichat-tabs').count()) return;
  await toSettingsRoot();
  await p.locator('.settings-nav-title', { hasText: /^AI$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: /^AI 对话$/ }).click();
  await p.waitForTimeout(700);
};

await step('打开并载入示例数据', async () => {
  await p.goto(APP, { waitUntil: 'load' });
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );
  const has = await p.getByText('载入示例数据看看效果').count();
  if (has) {
    await p.getByText('载入示例数据看看效果').click();
    await p.waitForTimeout(3000);
  }
});

await step('进 AI 对话页', async () => {
  await toSettingsRoot();
  await p.locator('.settings-nav-title', { hasText: /^AI$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: /^AI 对话$/ }).click();
  await p.waitForTimeout(700);
});

await step('配一个假模型', async () => {
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

await step('发一句话，让它把整条操作流跑完', async () => {
  await ensureAiPage();
  await p.locator('.aichat-tab', { hasText: '聊天' }).click();
  await p.waitForTimeout(400);
  await p.locator('.aichat-input textarea').fill('按我说的把这一批改动做完');
  await p.locator('.aichat-send').click();
  // 等「AI 干活中」消失：整条流有 5 轮工具调用
  await p.waitForSelector('.aichat-busy-chip', { state: 'detached', timeout: 180000 });
  await p.waitForTimeout(1200);
});

await step('看成果列表', async () => {
  await p.locator('.aichat-tab', { hasText: '成果' }).click();
  await p.waitForTimeout(900);
});
const snaps = await snapList();
console.log('\n成果条数：', snaps.length);
console.log(JSON.stringify(snaps, null, 2));

await step('点开第一条成果（暂存态，核对分组）', async () => {
  await p.locator('.aichat-snap-main').first().click();
  await p.waitForTimeout(1500);
});
console.log('\n暂存态详情：', JSON.stringify(await dumpDetail(), null, 2));

await step('点「执行这轮改动」', async () => {
  await p.getByRole('button', { name: '执行这轮改动' }).click();
  await p.waitForTimeout(2500);
});
console.log('执行后成果：', JSON.stringify(await snapList()));

await step('重新打开成果（已执行，diff 重算）', async () => {
  await p.locator('.aichat-snap-main').first().click();
  await p.waitForTimeout(1500);
});
const afterExec = await dumpDetail();
console.log('\n执行后详情：', JSON.stringify(afterExec, null, 2));

// 已执行后才有「拒绝选中」：勾掉「修改」组第一项，看它是否被还原
await step('勾选一项改动并拒绝', async () => {
  const updated = afterExec.groups.find((g) => g.head.includes('修改'));
  if (!updated?.items.length) throw new Error('修改组是空的，没有可拒绝的项');
  await p.locator('.aichat-diff-updated .aichat-diff-chip input').first().uncheck();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /拒绝选中的/ }).click();
  await p.waitForTimeout(2500);
});

await step('重新打开成果看净变化', async () => {
  const still = await p.locator('.aichat-snap-main').count();
  if (still) {
    await p.locator('.aichat-snap-main').first().click();
    await p.waitForTimeout(1500);
  }
});
console.log('拒绝后：', JSON.stringify(await dumpDetail()));

// 改动已落地，这时点开新增组里的对象，应该跳到真正的详情页（不是 AI 生成的页面）
await step('点开新增组里的对象', async () => {
  await p.locator('.aichat-diff-created .aichat-target').first().click();
  await p.waitForTimeout(1500);
});
const opened = await p.evaluate(() => ({
  title: document.querySelector('.page-head-title')?.textContent?.trim() ?? '',
  hasModal: !!document.querySelector('.modal'),
  body: document.body.innerText.slice(0, 40).replace(/\n/g, ' | '),
}));
console.log('\n点开后：', JSON.stringify(opened));

// 按返回键：应该原路回到那份成果详情，而不是被丢回人物列表
await step('按返回键', async () => {
  await p.locator('.back-btn').first().click();
  await p.waitForTimeout(1800);
});
const back = await p.evaluate(() => ({
  modalTitle: document.querySelector('.modal .aichat-snap-detail-title')?.textContent?.trim() ?? '',
  onTab: document.querySelector('.aichat-tab-on')?.textContent?.trim() ?? '',
  head: document.querySelector('.page-head-title')?.textContent?.trim() ?? '',
}));
console.log('返回后：', JSON.stringify(back));

// 事件走的是「时间线 + 弹窗」，没有返回键，靠点底部 tab 回成果
await step('关掉弹窗，点开新增组里的事件', async () => {
  await p.locator('.modal-head .icon-btn').first().click().catch(() => {});
  await p.waitForTimeout(500);
  await p.locator('.aichat-snap-main').first().click();
  await p.waitForTimeout(1200);
  await p.locator('.aichat-diff-created .aichat-target').nth(1).click();
  await p.waitForTimeout(1800);
});
console.log('事件跳转后：', JSON.stringify(await p.evaluate(() => ({
  head: document.querySelector('.page-head-title')?.textContent?.trim() ?? '',
  modal: document.querySelector('.modal-head h3')?.textContent?.trim() ?? '',
}))));

await step('关掉事件弹窗，点底部「设置」', async () => {
  await p.locator('.modal-head .icon-btn').first().click().catch(() => {});
  await p.waitForTimeout(600);
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.waitForTimeout(1500);
});
console.log('点设置后：', JSON.stringify(await p.evaluate(() => ({
  modalTitle: document.querySelector('.modal .aichat-snap-detail-title')?.textContent?.trim() ?? '',
  onTab: document.querySelector('.aichat-tab-on')?.textContent?.trim() ?? '',
  head: document.querySelector('.page-head-title')?.textContent?.trim() ?? '',
}))));

await b.close();
