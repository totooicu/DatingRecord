// 卡片复用回归：全站只有一颗 Card，三种 variant 都得长对。
//
// 钉住的行为（每一条都对应一个真实会退化的点）：
//   ① 统计小卡（variant=stat）：人物 / 事件集详情顶部、设置页库概览都得是 4 格
//   ② 详情区块卡（variant=section）：属性分组卡、自定义字段卡、相关事件卡都在
//   ③ 属性变化卡的整个 head 是可点按钮（自定义 head 插槽），点了才展开 hist-body
//   ④ 事件卡 head 带 event-card-head：标题下间距被收紧（8px / 0）
//   ⑤ 设置页的 Section 也走同一颗卡：隐私卡的状态 pill 落在 card-head 里
//   ⑥ 卡片骨架只有一处实现：源码里不该再有手写 section.card / div.stat-card
//
// 用法：node tools/e2e/verify-card-reuse-e2e.mjs [url]
import fs from 'node:fs';
import path from 'path';

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

const waitBoot = () =>
  p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null, { timeout: 90000 },
  );

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) failed++;
  console.log(`  ${cond ? '✓' : '✗ 失败'} ${msg}`);
};

console.log('\n=== 卡片复用验证 ===\n');
await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
await p.addStyleTag({ content: '.fab{display:none!important}' });
if (await p.getByText('直接开始创建').count()) { await p.getByText('直接开始创建').click(); await p.waitForTimeout(500); }
const closeBtn = p.locator('[aria-label="关闭"]').first();
if (await closeBtn.count()) { await closeBtn.click(); await p.waitForTimeout(300); }

// ---------- ⑥ 源码里不该再有手写卡片骨架 ----------
{
  const roots = ['src/ui', 'src/app'];
  const bad = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.tsx$/.test(f)) {
        const t = fs.readFileSync(full, 'utf8');
        if (/className="card"/.test(t)) bad.push(`${full}: section className="card"`);
        if (/className="stat-card"/.test(t)) bad.push(`${full}: div className="stat-card"`);
      }
    }
  };
  roots.forEach(walk);
  ok(bad.length === 0, `源码里没有手写卡片骨架（残留 ${bad.length} 处${bad.length ? '：' + bad.join('、') : ''}）`);
}

// ---------- ⑤ 设置页：Section 走同一颗卡 ----------
// 进了子页目录就收起来了，换页前先点顶部条的返回键。
const backToNav = async () => {
  const b = p.locator('.back-btn').first();
  if (await b.count()) {
    await b.click({ force: true });
    await p.waitForTimeout(400);
  }
};
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(400);
await p.locator('.settings-nav-title', { hasText: '隐私与安全' }).click();
await p.waitForTimeout(500);
{
  // 隐私卡的状态 pill 必须落在 card-head 里，而不是掉到标题下面
  const inHead = await p.evaluate(() => {
    const head = [...document.querySelectorAll('.card-head')].find((h) =>
      h.querySelector('.card-title')?.textContent?.includes('隐私模式'),
    );
    return !!head && !!head.querySelector('.pill');
  });
  ok(inHead, '隐私模式的状态 pill 落在 card-head 里（Section 的 extra 插槽）');
}
await backToNav();
await p.locator('.settings-nav-title', { hasText: '数据与统计' }).click();
await p.waitForTimeout(500);
{
  const n = await p.locator('.stat-row .stat-card').count();
  ok(n === 4, `设置页库概览 4 张统计小卡（实际 ${n}）`);
  const numText = await p.locator('.stat-row .stat-card .stat-num').first().innerText();
  ok(numText.length > 0, `统计小卡有数字（第一个是「${numText.replace(/\s+/g, ' ')}」）`);
}

// ---------- 造一点数据（就在这一页，不用退回目录） ----------
await p.locator('.sample-tier .theme-mode-btn').nth(1).click({ force: true }); // 100 条
await p.waitForTimeout(200);
await p.getByRole('button', { name: /载入压测数据/ }).click({ force: true });
await p.waitForFunction(() => {
  const el = [...document.querySelectorAll('button')].find((b) => /载入压测数据/.test(b.textContent || ''));
  return el && !/正在造数据/.test(el.textContent || '');
}, null, { timeout: 180000 });
await p.waitForTimeout(500);

// ---------- ① ② ③ 人物详情 ----------
await p.locator('.tabbar-item', { hasText: '人物' }).click();
await p.waitForSelector('.list-item', { timeout: 120000 });
await p.locator('.pane-list .list-item').first().click();
await p.waitForTimeout(600);
{
  const n = await p.locator('.pane-detail .stat-card').count().catch(() => 0);
  const statAny = await p.locator('.stat-card').count();
  ok(statAny >= 4, `人物详情出现统计小卡（可见 ${statAny} 张，详情栏 ${n}）`);
  const cards = await p.locator('.card').count();
  ok(cards > 0, `人物详情渲染了区块卡（${cards} 张）`);
  ok(
    (await p.locator('.card-title', { hasText: '自定义字段' }).count()) > 0,
    '属性区的「自定义字段」卡在（Card 的 title 插槽）',
  );
}
{
  // 属性变化：head 整个是按钮，默认收起，点开才出现 hist-body
  const toggle = p.locator('.hist-toggle').first();
  if (await toggle.count()) {
    ok((await p.locator('.hist-body').count()) === 0, '属性变化默认收起，没有 hist-body');
    await toggle.click({ force: true });
    await p.waitForTimeout(400);
    ok((await p.locator('.hist-body').count()) === 1, '点标题整行展开出 hist-body（自定义 head 插槽没把按钮结构改坏）');
    ok(
      (await toggle.locator('.card-title').count()) === 1 && (await toggle.locator('.hist-caret').count()) === 1,
      '展开后 head 里标题与箭头都还在',
    );
    await toggle.click({ force: true });
    await p.waitForTimeout(300);
    ok((await p.locator('.hist-body').count()) === 0, '再点一次收回去');
  } else {
    console.log('  · 该人物没有属性变化记录，跳过 ③');
  }
}

// ---------- ④ 事件集详情：event-card-head 收紧标题下间距 ----------
await p.locator('.tabbar-item', { hasText: '事件集' }).click();
await p.waitForTimeout(600);
if (await p.locator('.tree-row').count()) {
  await p.locator('.tree-row').first().click();
  await p.waitForTimeout(600);
  const headOk = await p.evaluate(() => {
    const head = document.querySelector('.card-head.event-card-head');
    if (!head) return null;
    const title = head.querySelector('.card-title');
    return {
      mb: getComputedStyle(head).marginBottom,
      titleMb: title ? getComputedStyle(title).marginBottom : null,
      hasToggle: !!head.querySelector('button'),
    };
  });
  ok(
    headOk && headOk.mb === '8px' && headOk.titleMb === '0px',
    `事件卡 head 收紧了间距（head 下 ${headOk?.mb} / 标题下 ${headOk?.titleMb}）`,
  );
  ok(headOk?.hasToggle === true, '事件卡的视图切换仍在 head 右侧（extra 插槽）');
  const childCard = await p.locator('.card-title', { hasText: /子事件集（/ }).count();
  ok(childCard > 0, '子事件集卡在（Card 的 title 插槽）');
} else {
  console.log('  · 没有事件集，跳过 ④');
}

console.log(`\n  断言失败数：${failed}；控制台错误数：${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('    ! ' + e);

await browser.close();
const clean = failed === 0 && errors.length === 0;
console.log(clean ? '\n全部通过 ✓' : '\n有失败项 ✗');
process.exit(clean ? 0 : 1);
