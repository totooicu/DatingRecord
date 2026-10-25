// 壳里系统返回键（ui.backPressed）逐层退栈的端到端回归。
//
// 壳（geckoview_example WebViewActivity.onBackKey）只把返回转成事件，
// 页面 3 秒内不回 ui.goBack / ui.finish 就按 canGoBack ? goBack : finish 兜底。
// 所以这里既看页面退到了哪一层，也看它有没有按时回执（兜底次数必须为 0）。
//
// 验证：
//   B1 人物详情 → 退回列表，回 ui.goBack；等过 3 秒壳的兜底不触发
//   B2 详情上的图标弹窗：返回只关弹窗，详情还在（浮层优先于页面）
//   B3 设置：子页 → 父级 → 目录 → ui.finish（两级 parentOf，根上退出）
//   B4 日历点某天 → 时间线「只看某天」→ 退回日历
//   B5 新建事件弹窗里开全屏编辑：先退全屏，再关弹窗（后进先出）
//   B6 列表根上返回 = ui.finish
//
// 壳用 addInitScript 装的假实现：注入标记 + ui.* 请求应答 + __pressBack()。
// 用法：node tools/e2e/shell-back-e2e.mjs [url]

import fs from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
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

const MOCK = `
(() => {
  const mark = () => {
    const de = document.documentElement;
    if (!de) return;
    de.setAttribute('data-gv-bridge-injected', 'true');
    de.setAttribute('data-gv-bridge-stage', 'injected');
    de.setAttribute('data-gv-bridge-native', 'heartbeat@mock');
  };
  mark();
  document.addEventListener('DOMContentLoaded', mark);

  const st = (window.__backStats = { goBack: 0, finish: 0, fallbacks: 0, calls: [] });
  const reply = (id, ok, result) =>
    window.postMessage({ type: 'gv-bridge-response', id, ok, result }, '*');

  // 和壳一样：按下返回后等 3 秒，页面没回执就兜底（这一份只计数）
  window.__pressBack = (atRoot) => {
    st.pending = true;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      if (!st.pending) return;
      st.fallbacks += 1;
      st.pending = false;
    }, 3000);
    window.postMessage(
      { type: 'gv-bridge-event', event: 'ui.backPressed', data: { atRoot: atRoot !== false } },
      '*'
    );
  };
  const handled = () => {
    st.pending = false;
    clearTimeout(st.timer);
  };

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.type !== 'gv-bridge-request') return;
    st.calls.push({ action: m.action, params: m.params });
    switch (m.action) {
      case 'ui.goBack':
        st.goBack += 1;
        handled();
        return reply(m.id, true, { handled: true });
      case 'ui.finish':
        st.finish += 1;
        handled();
        return reply(m.id, true, { finishing: true });
      case 'ping':
        return reply(m.id, true, { pong: true, shell: 'mock' });
      default:
        // 别的能力：假装成功，免得后台请求报错干扰返回键的观察
        return reply(m.id, true, {});
    }
  });
})();
`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(MOCK);
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
p.on('dialog', (d) => d.accept());

const waitBoot = async () => {
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );
};

const stats = () =>
  p.evaluate(() => ({
    goBack: window.__backStats.goBack,
    finish: window.__backStats.finish,
    fallbacks: window.__backStats.fallbacks,
  }));
const pressBack = async () => {
  await p.evaluate(() => window.__pressBack(true));
  await p.waitForTimeout(500);
};
const appClass = () => p.locator('.app').getAttribute('class');
const modalCount = () => p.locator('.modal-mask').count();
const tab = async (label) => {
  await p.locator('.tabbar-item', { hasText: label }).click();
  await p.waitForTimeout(500);
};

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(3000);
}

console.log('\nB1 人物详情 → 返回列表，并回执 ui.goBack');
await tab('人物');
await p.locator('.list-item').first().click();
await p.waitForTimeout(600);
check('已进入详情', ((await appClass()) ?? '').includes('at-detail'), await appClass());
let before = await stats();
await pressBack();
let after = await stats();
check('退回列表', ((await appClass()) ?? '').includes('at-list'), await appClass());
check('回了 ui.goBack', after.goBack === before.goBack + 1, `${before.goBack} → ${after.goBack}`);
check('没有回 ui.finish', after.finish === before.finish, `${after.finish}`);
// 这一下已经等过 3 秒兜底窗口：页面回过执，壳就不该再兜底
await p.waitForTimeout(2800);
check('等过 3 秒壳的兜底没触发', (await stats()).fallbacks === 0, JSON.stringify(await stats()));

console.log('\nB2 详情上的图标弹窗：先关弹窗，页面不退');
await p.locator('.list-item').first().click();
await p.waitForTimeout(600);
await p.locator('.avatar-head').click();
await p.waitForTimeout(500);
check('图标弹窗打开', (await modalCount()) === 1, `modal=${await modalCount()}`);
before = await stats();
await pressBack();
after = await stats();
check('弹窗关掉', (await modalCount()) === 0, `modal=${await modalCount()}`);
check('详情还留在原处', ((await appClass()) ?? '').includes('at-detail'), await appClass());
check('回了 ui.goBack', after.goBack === before.goBack + 1, `${before.goBack} → ${after.goBack}`);

console.log('\nB3 设置：子页 → 父级 → 目录 → 退出');
await tab('设置');
const title = async () => (await p.locator('.page-head-title').first().innerText()).trim();
check('设置目录', (await title()) === '设置与数据', await title());
await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
await p.waitForTimeout(500);
await p.locator('.settings-hub-title', { hasText: '定位' }).first().click();
await p.waitForTimeout(600);
check('进了定位子页', (await title()) === '定位', await title());
before = await stats();
await pressBack();
after = await stats();
check('退回功能面板（父级）', (await title()) === '功能面板', await title());
check('回了 ui.goBack', after.goBack === before.goBack + 1, `${before.goBack} → ${after.goBack}`);
before = await stats();
await pressBack();
after = await stats();
check('再退回设置目录', (await title()) === '设置与数据', await title());
check('目录页没有返回按钮', (await p.locator('.back-btn').count()) === 0);
check('回了 ui.goBack', after.goBack === before.goBack + 1, `${before.goBack} → ${after.goBack}`);
before = await stats();
await pressBack();
after = await stats();
check('目录根上让壳退出（ui.finish）', after.finish === before.finish + 1, `${before.finish} → ${after.finish}`);
check('停在这一页等壳关（不自己乱跳）', (await title()) === '设置与数据', await title());

console.log('\nB4 日历某天 → 时间线「只看某天」→ 退回日历');
await tab('日历');
await p.locator('.cal-cell:not(.cal-out)').first().click();
await p.waitForTimeout(800);
check('进了只看某天的时间线', ((await appClass()) ?? '').includes('at-timeline'), await appClass());
check('出现「只看某天」标记', (await p.locator('.tl-daychip').count()) === 1);
before = await stats();
await pressBack();
after = await stats();
check('退回日历', ((await appClass()) ?? '').includes('at-calendar'), await appClass());
check('「只看某天」标记清掉', (await p.locator('.tl-daychip').count()) === 0);
check('回了 ui.goBack', after.goBack === before.goBack + 1, `${before.goBack} → ${after.goBack}`);

console.log('\nB5 新建事件弹窗 + 全屏编辑：后进先出');
await tab('人物');
await p.locator('.fab').click();
await p.waitForTimeout(600);
check('新建事件弹窗打开', (await modalCount()) === 1, `modal=${await modalCount()}`);
await p.locator('.md-full-btn').first().click();
await p.waitForTimeout(400);
check('正文进入全屏编辑', (await p.locator('.md-editor-full').count()) === 1);
before = await stats();
await pressBack();
after = await stats();
check('先退全屏', (await p.locator('.md-editor-full').count()) === 0);
check('弹窗还在', (await modalCount()) === 1, `modal=${await modalCount()}`);
check('回了 ui.goBack', after.goBack === before.goBack + 1, `${before.goBack} → ${after.goBack}`);
before = await stats();
await pressBack();
after = await stats();
check('再关弹窗', (await modalCount()) === 0, `modal=${await modalCount()}`);
check('回到人物列表', ((await appClass()) ?? '').includes('at-list'), await appClass());
check('回了 ui.goBack', after.goBack === before.goBack + 1, `${before.goBack} → ${after.goBack}`);

console.log('\nB6 列表根上返回 = 退出');
before = await stats();
await pressBack();
after = await stats();
check('调了 ui.finish', after.finish === before.finish + 1, `${before.finish} → ${after.finish}`);
check('没有多调 ui.goBack', after.goBack === before.goBack, `${before.goBack} → ${after.goBack}`);
await p.waitForTimeout(2800);
check('全程没有任何一次落到壳的兜底', (await stats()).fallbacks === 0, JSON.stringify(await stats()));

await ctx.close();
await browser.close();

console.log(`\n========== 汇总 ==========\n${failures.length ? `失败 ${failures.length} 项：${failures.join(' / ')}` : '全部通过 ✓'}`);
process.exit(failures.length ? 1 : 0);
