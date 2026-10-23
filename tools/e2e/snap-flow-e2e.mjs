// 端到端跑一遍「AI 连续做很多操作」的流程，检查成果是不是：
//   1) 只有 1 条  2) 详情按 新增 / 修改 / 删除 分组  3) 分组里的项能点开真实详情页
//
// 用法：
//   node tools/e2e/fake-ai-flow.mjs        # 另开一个终端，假模型服务
//   npx vite --port 5173                   # dev 服务
//   node tools/e2e/snap-flow-e2e.mjs [url]
//
// 依赖：全局 playwright + 上面的两个服务。手机视口（390×844）下跑，贴近真实使用。

import { chromium } from '/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs';

const APP = process.argv[2] || 'http://localhost:5173/';
const FAKE = process.env.FAKE ?? 'http://localhost:8791/v1';

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));
p.on('console', (m) => {
  if (m.type() === 'error') console.log('[console]', m.text().slice(0, 160));
});

const step = async (label, fn) => {
  process.stdout.write(`· ${label} … `);
  await fn();
  console.log('ok');
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
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-nav-item', { hasText: '功能体验' }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-item', { hasText: 'AI 对话' }).click();
  await p.waitForTimeout(700);
});

await step('配一个假模型', async () => {
  await p.locator('.aichat-tab', { hasText: '模型' }).click();
  await p.waitForTimeout(500);
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
  await p.locator('.aichat-tab', { hasText: '聊天' }).click();
  await p.waitForTimeout(400);
  await p.locator('.aichat-input textarea').fill('按我说的把这一批改动做完');
  await p.locator('.aichat-send').click();
  // 等「AI 干活中」消失：整条流有 5 轮工具调用
  await p.waitForSelector('.aichat-busy-chip', { state: 'detached', timeout: 180000 });
  await p.waitForTimeout(1200);
});

const snaps = await (async () => {
  await p.locator('.aichat-tab', { hasText: '成果' }).click();
  await p.waitForTimeout(900);
  return p.evaluate(() =>
    [...document.querySelectorAll('.aichat-snap-list li')].map((li) => ({
      title: li.querySelector('.aichat-snap-title')?.textContent?.trim() ?? '',
      sub: li.querySelector('.aichat-snap-sub')?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
    })),
  );
})();
console.log('\n成果条数：', snaps.length);
console.log(JSON.stringify(snaps, null, 2));

await step('点开第一条成果', async () => {
  await p.locator('.aichat-snap-main').first().click();
  await p.waitForTimeout(1500);
});

const detail = await p.evaluate(() => {
  const m = document.querySelector('.modal');
  if (!m) return { err: '没有弹窗' };
  const groups = [...m.querySelectorAll('.aichat-diff-group')].map((g) => ({
    head: g.querySelector('.aichat-diff-head')?.textContent?.trim() ?? '',
    items: [...g.querySelectorAll('.aichat-target-name')].map((x) => x.textContent.trim()),
  }));
  return {
    title: m.querySelector('.aichat-snap-detail-title')?.textContent?.trim() ?? '',
    groups,
    revertedNote: m.querySelector('.aichat-diff-note')?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
    ops: [...m.querySelectorAll('.aichat-op')].map(
      (o) =>
        `${o.classList.contains('aichat-op-bad') ? '✗' : '✓'} ${
          o.querySelector('.aichat-op-text')?.textContent?.trim() ?? ''
        }${o.querySelector('.aichat-op-err')?.textContent?.trim() ? ` → ${o.querySelector('.aichat-op-err').textContent.trim()}` : ''}`,
    ),
  };
});
console.log('\n成果详情：', JSON.stringify(detail, null, 2));

await p.screenshot({ path: '/tmp/snap-detail.png' });

// 点「新增」里第一个对象，应该跳到真正的详情页（不是 AI 生成的页面）
await step('点开新增组里的对象', async () => {
  await p.locator('.aichat-diff-created .aichat-target').first().click();
  await p.waitForTimeout(1200);
});
const opened = await p.evaluate(() => ({
  title: document.querySelector('.page-head-title')?.textContent?.trim() ?? '',
  hasModal: !!document.querySelector('.modal'),
  body: document.body.innerText.slice(0, 40).replace(/\n/g, ' | '),
}));
console.log('\n点开后：', JSON.stringify(opened));

// 回成果页，拒绝其中一项改动，看它是否被还原
await step('回到成果页', async () => {
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-nav-item', { hasText: '功能体验' }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-item', { hasText: 'AI 对话' }).click();
  await p.waitForTimeout(600);
  await p.locator('.aichat-tab', { hasText: '成果' }).click();
  await p.waitForTimeout(700);
});

p.on('dialog', (d) => d.accept());
await step('勾选一项改动并拒绝', async () => {
  await p.locator('.aichat-snap-main').first().click();
  await p.waitForTimeout(1200);
  const groups = await p.evaluate(() =>
    [...document.querySelectorAll('.aichat-diff-group')].map((g) => ({
      head: g.querySelector('.aichat-diff-head')?.textContent?.trim() ?? '',
      items: [...g.querySelectorAll('.aichat-target-name')].map((x) => x.textContent.trim()),
    })),
  );
  console.log('\n拒绝前：', JSON.stringify(groups));
  // 取消勾选「修改」组的第一项 = 拒绝这一处改动
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
const after = await p.evaluate(() => {
  const m = document.querySelector('.modal');
  if (!m) return { err: '没有弹窗' };
  return [...m.querySelectorAll('.aichat-diff-group')].map((g) => ({
    head: g.querySelector('.aichat-diff-head')?.textContent?.trim() ?? '',
    items: [...g.querySelectorAll('.aichat-target-name')].map((x) => x.textContent.trim()),
  }));
});
console.log('拒绝后：', JSON.stringify(after));

await b.close();
