// 分页回归：一处控件、四处列表、一个设备级「每页条数」。
//
// 钉住的行为（每一条都对应一个真实会退化的点）：
//   ①  人物列表按每页条数渲染，翻页后内容真的换了
//   ①b 分页条钉在底部导航栏上方，列表滚到中间也跟着吸住
//   ①c 悬浮「记一件事」不压分页条右端（钉到底之后才会撞）
//   ①d 翻页后把列表滚回顶部（不然新页只露出最后几行，看着像没翻页）
//   ②  导航按钮是图标不是文字（aria-label 保留可访问名，读屏和本脚本都靠它）
//   ③  跳到指定页（Enter 提交 / Escape 取消草稿）
//   ④  首页 / 末页，端点置灰
//   ⑤  每页条数是设备偏好：改一次总页数重算、写进 localStorage
//   ⑥  不足一页 → 整条分页控件不出现（否则每张卡片都挂一行噪音）
//   ⑦  时间线 / 事件集 / 文件用的是同一颗控件（以前只有人物列表有分页）
//   ⑧  陪伴 / 专注模式切换隐藏说明文字（沿用上一版，别在改版时丢掉）
//
// 用法：node tools/e2e/verify-pagination-mode-e2e.mjs [url] [scale]
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const APP = process.argv[2] || 'http://localhost:4173/';
const SCALE = process.argv[3] || '1000';
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'dr-verify-'));
fs.mkdirSync(SHOTS, { recursive: true });

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

const waitBoot = async () => {
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null, { timeout: 90000 },
  );
};
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) failed++;
  console.log(`  ${cond ? '✓' : '✗ 失败'} ${msg}`);
};

// 分页条必须按栏取：手机端两栏都在 DOM 里（另一栏 display:none），
// 光按 .pager 选会把详情栏里那条（或看不见的那条）当成当前这条。
const PANE = {
  persons: '.pane-list',
  collections: '.pane-list',
  timeline: '.pane-pin',
  files: '.pane-solo',
};
const pagerOf = (k) => p.locator(`${PANE[k]} .pager`);
const navBtn = (k, name) => p.locator(`${PANE[k]} .pager`).getByRole('button', { name });
const jumpVal = (k) => pagerOf(k).locator('.pager-jump').inputValue();
const ofVal = (k) => pagerOf(k).locator('.pager-of').innerText();
const sizeSel = (k) => pagerOf(k).locator('.pager-size');
const rowSel = {
  persons: '.list-item',
  timeline: '.month-group .event-item',
  collections: '.tree-row',
  files: '.file-list li',
};
const rowCount = (k) => p.locator(rowSel[k]).count();

console.log(`\n=== 验证（scale=${SCALE}）===\n`);
await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
// 测试环境：隐藏全局悬浮「记一件事」按钮，避免它挡住设置页按钮拦截点击。
// 注入到 <head>，React 不会重渲染 head，故子页面切换导致的重挂载也不会让它复活。
// ①c 那一段会临时放回来量一次。
const fabStyle = await p.addStyleTag({ content: '.fab{display:none!important}' });
if (await p.getByText('直接开始创建').count()) { await p.getByText('直接开始创建').click(); await p.waitForTimeout(500); }
const closeBtn = p.locator('[aria-label="关闭"]').first();
if (await closeBtn.count()) { await closeBtn.click(); await p.waitForTimeout(300); }

// ---------- 载入压测数据（从目录进入，避免进入子页后目录被隐藏） ----------
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(400);
await p.locator('.settings-nav-title', { hasText: '数据与统计' }).click();
await p.waitForTimeout(500);
const TIERS = ['10', '100', '1000', '10000'];
const tierIdx = TIERS.indexOf(String(SCALE));
if (tierIdx < 0) throw new Error(`未知量级 ${SCALE}`);
await p.locator('.sample-tier .theme-mode-btn').nth(tierIdx).click({ force: true });
await p.waitForTimeout(200);
await p.getByRole('button', { name: /载入压测数据/ }).click({ force: true });
await p.waitForFunction(() => {
  const el = [...document.querySelectorAll('button')].find((b) => /载入压测数据/.test(b.textContent || ''));
  return el && !/正在造数据/.test(el.textContent || '');
}, null, { timeout: 180000 });
await p.waitForTimeout(500);

// ---------- ① 人物列表分页 ----------
await p.locator('.tabbar-item', { hasText: '人物' }).click();
await p.waitForSelector('.list-item', { timeout: 120000 });
await p.waitForTimeout(400);

ok((await rowCount('persons')) === 50, `默认每页 50 条（实际渲染 ${await rowCount('persons')}）`);
ok((await pagerOf('persons').count()) === 1, '人物列表出现分页条');
ok((await jumpVal('persons')) === '1', `分页条停在第 1 页（${await jumpVal('persons')} ${await ofVal('persons')}）`);
const pagesAt50 = parseInt((await ofVal('persons')).slice(1), 10);

// ---------- ② 图标不是文字 ----------
// 屏幕上看不到「上一页 / 下一页」这些字，但可访问名必须在——读屏和本脚本都靠它。
const navShape = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('.pane-list .pager .pager-btn')];
  return {
    n: btns.length,
    text: btns.map((b) => (b.textContent || '').trim()),
    labels: btns.map((b) => b.getAttribute('aria-label')),
    svgs: btns.map((b) => b.querySelectorAll('svg').length),
  };
});
ok(navShape.n === 4, `四个方向键（首页/上一页/下一页/末页）=${navShape.n}`);
ok(navShape.text.every((t) => t === ''), `方向键上没有文字（${JSON.stringify(navShape.text)}）`);
ok(navShape.labels.join(',') === '首页,上一页,下一页,末页', `可访问名齐全（${navShape.labels.join(' / ')}）`);
ok(navShape.svgs.every((n) => n === 1), '每颗方向键里都是一支 SVG 箭头');
ok((await pagerOf('persons').locator('.pager-jump').count()) === 1, '有「跳到指定页」输入框');
ok((await pagerOf('persons').locator('.pager-size').count()) === 1, '有「每页条数」下拉');
const pagerText = await pagerOf('persons').innerText();
ok(!/上一页|下一页|首页|末页/.test(pagerText), `分页条上看不到文字（"${pagerText.replace(/\n/g, ' ')}"）`);

// ---------- ①d 下一页：换内容 + 滚回顶部 ----------
const flip = await p.evaluate(() => {
  const pane = document.querySelector('.pane-list');
  pane.scrollTop = pane.scrollHeight;
  return {
    atBottom: pane.scrollTop,
    firstBefore: document.querySelector('.list-item .list-item-title')?.textContent || '',
  };
});
await navBtn('persons', '下一页').click();
await p.waitForTimeout(400);
const afterNext = await p.evaluate(() => ({
  scrollTop: document.querySelector('.pane-list').scrollTop,
  first: document.querySelector('.list-item .list-item-title')?.textContent || '',
}));
ok(afterNext.first !== flip.firstBefore, `下一页换了内容（"${flip.firstBefore}" → "${afterNext.first}"）`);
ok((await jumpVal('persons')) === '2', `页码到 2（实际 ${await jumpVal('persons')}）`);
ok(afterNext.scrollTop < 5, `翻页后滚回顶部（scrollTop=${afterNext.scrollTop}，翻页前停在 ${flip.atBottom}）`);
ok((await rowCount('persons')) === 50, `第 2 页仍渲染 50 条（实际 ${await rowCount('persons')}）`);
await navBtn('persons', '上一页').click();
await p.waitForTimeout(300);
ok((await jumpVal('persons')) === '1', `上一页回到 1（实际 ${await jumpVal('persons')}）`);

// ---------- ③ 跳到指定页 ----------
// 目标页取最后一页：①d 已经看过第 1、2 页的内容，跳到一个没到过的页码才证得出
// 「真的按输入的数字换了页」，而不是又回到第 2 页那种假绿。
const JUMP = pagesAt50;
await pagerOf('persons').locator('.pager-jump').click({ clickCount: 3 });
await p.keyboard.type(String(JUMP));
await p.keyboard.press('Enter');
await p.waitForTimeout(400);
const jumped = await p.evaluate(() => document.querySelector('.list-item .list-item-title')?.textContent || '');
ok((await jumpVal('persons')) === String(JUMP), `输入 ${JUMP} + Enter 跳到第 ${JUMP} 页（输入框=${await jumpVal('persons')}）`);
ok(jumped !== '' && jumped !== flip.firstBefore && jumped !== afterNext.first, `跳页后首条换了（"${jumped}"）`);
// Escape 撤销正在敲的草稿：半途的数字不该把用户带走
await pagerOf('persons').locator('.pager-jump').click({ clickCount: 3 });
await p.keyboard.type('9');
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
ok((await jumpVal('persons')) === String(JUMP), `Escape 取消草稿，页码不变（${await jumpVal('persons')}）`);

// ---------- ④ 首页 / 末页 ----------
// ③ 已经跳到最后一页，「末页」当场是灰的：先回首页再测两端
await navBtn('persons', '首页').click();
await p.waitForTimeout(300);
await navBtn('persons', '末页').click();
await p.waitForTimeout(400);
ok((await jumpVal('persons')) === String(pagesAt50), `末页跳到最后一页 ${pagesAt50}（实际 ${await jumpVal('persons')} ${await ofVal('persons')}）`);
const lastRows = await rowCount('persons');
ok(lastRows > 0 && lastRows <= 50, `最后一页不满也正常渲染（${lastRows} 条）`);
ok((await navBtn('persons', '下一页').isDisabled()) && (await navBtn('persons', '末页').isDisabled()), '末页时「下一页 / 末页」置灰');
await navBtn('persons', '首页').click();
await p.waitForTimeout(300);
ok((await jumpVal('persons')) === '1', `首页回到 1（实际 ${await jumpVal('persons')}）`);
ok((await navBtn('persons', '上一页').isDisabled()) && (await navBtn('persons', '首页').isDisabled()), '首页时「上一页 / 首页」置灰');

// ---------- ①b 分页条的位置：贴着底部导航栏，不留一大截空白 ----------
// 只看几何，不看像素：分页条下沿与 tabbar 上沿的缝、以及滚动时它是否还在视野里。
const pagerGeo = await p.evaluate(() => {
  const pagerEl = document.querySelector('.pane-list .pager');
  const tab = document.querySelector('.tabbar');
  const pane = document.querySelector('.pane-list');
  if (!pagerEl || !tab) return null;
  const gapAt = () => Math.round(tab.getBoundingClientRect().top - pagerEl.getBoundingClientRect().bottom);
  const visible = () => {
    const r = pagerEl.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= tab.getBoundingClientRect().top + 1;
  };
  const before = { gap: gapAt(), visible: visible() };
  pane.scrollTop = 240;
  const mid = { gap: gapAt(), visible: visible() };
  pane.scrollTop = 0;
  return { before, mid };
});
ok(!!pagerGeo, '人物列表里有分页条（.pane-list .pager）');
ok(pagerGeo?.before.gap === 0, `分页条下沿与导航栏上沿无缝（gap=${pagerGeo?.before.gap}）`);
ok(pagerGeo?.before.visible === true, '列表不满/满屏时分页条都在视野内');
ok(pagerGeo?.mid.visible === true, `列表滚到中间分页条仍吸在导航栏上方（gap=${pagerGeo?.mid.gap}）`);

// 窄屏不许横向溢出：分页条宁可丢掉区间，也不能把「每页条数」挤到屏幕外
const noOverflow = await p.evaluate(() => {
  const el = document.querySelector('.pane-list .pager');
  return el ? { over: el.scrollWidth - el.clientWidth, w: el.clientWidth } : null;
});
ok(noOverflow !== null && noOverflow.over <= 0, `分页条不横向溢出（overflow=${noOverflow?.over}px，宽 ${noOverflow?.w}px）`);

// ---------- ①c 悬浮按钮不压分页条 ----------
// 分页条钉到底部后，右下角那颗 FAB 正好压在它的右端；上面为了点设置页按钮把 .fab 藏了，
// 这一段先放出来量整条分页条（不再只量某一颗），量完再藏回去。
await fabStyle.evaluate((el) => el.remove());
const fabHit = await p.evaluate(() => {
  const fab = document.querySelector('.fab');
  const pagerEl = document.querySelector('.pane-list .pager');
  if (!fab || !pagerEl) return { skip: true };
  const kids = [...pagerEl.children].filter((c) => getComputedStyle(c).display !== 'none');
  const right = Math.max(...kids.map((c) => c.getBoundingClientRect().right));
  const f = fab.getBoundingClientRect();
  const hit = f.left < right && f.bottom > pagerEl.getBoundingClientRect().top && f.top < pagerEl.getBoundingClientRect().bottom;
  // 最右那一项（每页条数）正中命中测试：命中的必须是它自己，而不是浮在上面的 FAB
  const last = kids[kids.length - 1];
  const r = last.getBoundingClientRect();
  const topEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const reached = !!topEl && (last === topEl || last.contains(topEl));
  return { hit, reached, right: Math.round(right), fabLeft: Math.round(f.left) };
});
ok(fabHit?.skip === true || fabHit?.hit === false, `悬浮按钮不压分页条任何一项（hit=${fabHit?.hit}，分页条右端 ${fabHit?.right} < FAB 左边 ${fabHit?.fabLeft}）`);
ok(fabHit?.skip === true || fabHit?.reached === true, `点分页条最右一项命中的是它本身（${fabHit?.reached}）`);
await p.addStyleTag({ content: '.fab{display:none!important}' });

// ---------- ⑤ 每页条数是设备偏好 ----------
const SIZE = 20;
await sizeSel('persons').selectOption(String(SIZE));
await p.waitForTimeout(500);
ok((await rowCount('persons')) === SIZE, `人物列表按新偏好渲染 ${SIZE} 条（实际 ${await rowCount('persons')}）`);
const pagesAt20 = parseInt((await ofVal('persons')).slice(1), 10);
ok(pagesAt20 > pagesAt50, `总页数跟着重算（${pagesAt50} 页 → ${pagesAt20} 页）`);
const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('dr.prefs.v1') || '{}').pageSize);
ok(stored === SIZE, `每页条数写进设备偏好（localStorage=${stored}）`);

// ---------- ⑦ 时间线：同一颗分页控件 ----------
await p.locator('.tabbar-item', { hasText: '时间线' }).click();
await p.waitForSelector('.month-group .event-item', { timeout: 60000 });
await p.waitForTimeout(400);
const tlShape = await p.evaluate(() => {
  const el = document.querySelector('.pane-pin .pager');
  if (!el) return null;
  return {
    btns: el.querySelectorAll('.pager-btn').length,
    jump: !!el.querySelector('.pager-jump'),
    size: !!el.querySelector('.pager-size'),
    more: [...document.querySelectorAll('button')].some((b) => /显示更多/.test(b.textContent || '')),
  };
});
ok(!!tlShape, '时间线有分页条（.pane-pin .pager）');
ok(tlShape?.btns === 4 && tlShape?.jump === true && tlShape?.size === true, '时间线用的是同一颗控件（四个箭头 + 跳页 + 每页条数）');
ok(tlShape?.more === false, '时间线不再用「显示更多」渐进渲染');
ok((await rowCount('timeline')) === SIZE, `时间线每页 ${SIZE} 条（实际 ${await rowCount('timeline')}）`);
ok((await jumpVal('timeline')) === '1', `时间线从第 1 页开始（${await jumpVal('timeline')} ${await ofVal('timeline')}）`);
const tlBefore = await p.evaluate(() => document.querySelector('.month-group .event-item .event-title-text')?.textContent || '');
await navBtn('timeline', '下一页').click();
await p.waitForTimeout(500);
const tlAfter = await p.evaluate(() => document.querySelector('.month-group .event-item .event-title-text')?.textContent || '');
ok(tlAfter !== '' && tlAfter !== tlBefore, `时间线翻页换了内容（"${tlBefore}" → "${tlAfter}"）`);
ok((await rowCount('timeline')) === SIZE, `时间线第 2 页仍是 ${SIZE} 条（实际 ${await rowCount('timeline')}）`);
const tlGeo = await p.evaluate(() => {
  const el = document.querySelector('.pane-pin .pager');
  const tab = document.querySelector('.tabbar');
  if (!el || !tab) return null;
  return Math.round(tab.getBoundingClientRect().top - el.getBoundingClientRect().bottom);
});
ok(tlGeo === 0, `时间线分页条同样贴着导航栏（gap=${tlGeo}）`);

// ---------- ⑦ 事件集：树摊平成可见行后分页 ----------
await p.locator('.tabbar-item', { hasText: '事件集' }).click();
await p.waitForSelector('.tree-row', { timeout: 60000 });
await p.waitForTimeout(500);
ok((await rowCount('collections')) === SIZE, `事件集列表每页 ${SIZE} 行（实际 ${await rowCount('collections')}）`);
ok((await pagerOf('collections').locator('.pager-btn').count()) === 4, '事件集用的是同一颗分页控件');
const colBefore = await p.evaluate(() => document.querySelector('.tree-row .tree-label')?.textContent || '');
await navBtn('collections', '末页').click();
await p.waitForTimeout(500);
const colAfter = await p.evaluate(() => document.querySelector('.tree-row .tree-label')?.textContent || '');
ok(colAfter !== '' && colAfter !== colBefore, `事件集跳到末页换了内容（"${colBefore}" → "${colAfter}"）`);
const colPages = parseInt((await ofVal('collections')).slice(1), 10);
// 折叠测试要先回第一页：末页那一屏全是叶子节点，toggle 全是 disabled，点了等于没测
await navBtn('collections', '首页').click();
await p.waitForTimeout(400);
// 折叠一整棵子树：分页计数要跟着变小，不能把看不见的行算进「共几页」。
// 压测数据第一屏那个父集合下面挂着几十个子集，折掉之后很可能一页就装完了 ——
// 那时整条分页控件自己消失，同样是「看不见的行不算数」的证据，两种结果都要接住。
const collapse = async () => p.evaluate(() => {
  const rows = [...document.querySelectorAll('.pane-list .tree-row')];
  const row = rows.find((r) => r.querySelector('.tree-toggle:not([disabled])'));
  if (!row) return null;
  row.querySelector('.tree-toggle').click();
  return row.querySelector('.tree-label')?.textContent || '';
});
const expand = (label) => p.evaluate((name) => {
  const rows = [...document.querySelectorAll('.pane-list .tree-row')];
  const row = rows.find((r) => (r.querySelector('.tree-label')?.textContent || '') === name);
  if (!row) return false;
  row.querySelector('.tree-toggle').click();
  return true;
}, label);
const collapsedLabel = await collapse();
await p.waitForTimeout(500);
ok(collapsedLabel !== null, `事件集里有可折叠的节点（"${collapsedLabel}"）`);
const pagerGoneAfterCollapse = (await pagerOf('collections').count()) === 0;
const pagesAfterCollapse = pagerGoneAfterCollapse ? 1 : parseInt((await ofVal('collections')).slice(1), 10);
const rowsAfterCollapse = await rowCount('collections');
ok(
  pagesAfterCollapse < colPages,
  `折叠子树后总页数变小（${colPages} → ${pagesAfterCollapse}${pagerGoneAfterCollapse ? '，一页装完、分页条整条消失' : ''}）`,
);
ok(
  pagerGoneAfterCollapse ? rowsAfterCollapse <= SIZE : rowsAfterCollapse === SIZE,
  `折叠后这一页渲染 ${rowsAfterCollapse} 行（每页 ${SIZE}）`,
);
// 再展开回去：计数要还原，分页条该重新出现（否则「折叠」只是把列表算坏了）
if (collapsedLabel !== null) {
  ok((await expand(collapsedLabel)) === true, `找得回那一行并重新展开（"${collapsedLabel}"）`);
  await p.waitForTimeout(500);
  ok(
    (await pagerOf('collections').count()) === 1 && parseInt((await ofVal('collections')).slice(1), 10) === colPages,
    `展开后总页数回到 ${colPages}（现在 ${await ofVal('collections')}）`,
  );
}

// ---------- ⑥ 不足一页 → 整条分页控件不出现 ----------
await sizeSel('collections').selectOption('500');
await p.waitForTimeout(600);
ok((await pagerOf('collections').count()) === 0, `每页 500 时事件集一页装完，分页条不出现（还在的条数=${await pagerOf('collections').count()}）`);
await p.locator('.tabbar-item', { hasText: '人物' }).click();
await p.waitForTimeout(600);
ok((await pagerOf('persons').count()) === 0, `每页 500 时人物列表也不挂分页条（条数=${await pagerOf('persons').count()}）`);
const allPersons = await rowCount('persons');
ok(allPersons > 0 && allPersons < 500, `这时人物列表一次铺满 ${allPersons} 条`);

// 刷新：设备偏好还在，各列表仍按它渲染
await p.reload({ waitUntil: 'load' });
await waitBoot();
await p.waitForTimeout(800);
const afterReload = await p.evaluate(() => ({
  stored: JSON.parse(localStorage.getItem('dr.prefs.v1') || '{}').pageSize,
  rows: document.querySelectorAll('.list-item').length,
}));
ok(afterReload.stored === 500, `刷新后每页条数还是偏好里那个数（${afterReload.stored}）`);
ok(afterReload.rows === allPersons, `刷新后人物列表按 500/页 铺满（实际 ${afterReload.rows}）`);

// ---------- ⑦ 文件列表：跟着同一个偏好 ----------
await p.evaluate(() => localStorage.setItem('dr.prefs.v1', JSON.stringify({ guide: 'companion', collectionView: 'list', pageSize: 20 })));
await p.reload({ waitUntil: 'load' });
await waitBoot();
await p.waitForTimeout(800);
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(400);
const backBtn = p.locator('[aria-label="返回"]').first();
if (await backBtn.count()) { await backBtn.click(); await p.waitForTimeout(300); }
await p.locator('.settings-nav-title', { hasText: '文件' }).click();
await p.waitForSelector('.file-list li', { timeout: 60000 });
await p.waitForTimeout(400);
ok((await rowCount('files')) === 20, `文件列表跟着设备偏好走：每页 20 条（实际 ${await rowCount('files')}）`);
const fileShape = await p.evaluate(() => {
  const el = document.querySelector('.pager');
  if (!el) return null;
  return { btns: el.querySelectorAll('.pager-btn').length, jump: !!el.querySelector('.pager-jump'), text: (el.textContent || '').trim() };
});
ok(fileShape?.btns === 4 && fileShape?.jump === true, '文件列表用的是同一颗分页控件');
ok(fileShape !== null && !/下一页|上一页/.test(fileShape.text), `文件分页条上也没有文字（"${fileShape?.text}"）`);

// ---------- ⑧ 陪伴/专注模式 ----------
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(300);
const backBtn2 = p.locator('[aria-label="返回"]').first();
if (await backBtn2.count()) { await backBtn2.click(); await p.waitForTimeout(300); }
await p.locator('.settings-nav-title', { hasText: '外观' }).click();
await p.waitForTimeout(500);

const guideAttr = () => p.evaluate(() => document.documentElement.getAttribute('data-guide'));
const guideVisibleCount = () => p.evaluate(() => {
  const els = [...document.querySelectorAll('.guide-only')];
  return els.filter((e) => getComputedStyle(e).display !== 'none').length;
});

ok((await guideAttr()) === 'companion', `默认模式 = companion（实际 ${await guideAttr()}）`);
const guideShownDefault = await guideVisibleCount();

await p.getByRole('button', { name: '专注模式' }).click({ force: true });
await p.waitForTimeout(300);
ok((await guideAttr()) === 'focus', `切到专注模式 → data-guide=focus（实际 ${await guideAttr()}）`);
const guideShownFocus = await guideVisibleCount();
ok(guideShownFocus < guideShownDefault, `专注模式隐藏了说明文字（可见 ${guideShownDefault} → ${guideShownFocus}）`);

await p.getByRole('button', { name: '陪伴模式' }).click({ force: true });
await p.waitForTimeout(300);
ok((await guideAttr()) === 'companion', `切回陪伴模式 → data-guide=companion（实际 ${await guideAttr()}）`);
ok((await guideVisibleCount()) === guideShownDefault, `陪伴模式恢复说明文字（可见 ${await guideVisibleCount()}）`);

console.log(`\n  断言失败数：${failed}；控制台错误数：${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('    ! ' + e);

await browser.close();
const clean = failed === 0 && errors.length === 0;
console.log(clean ? '\n全部通过 ✓' : '\n有失败项 ✗');
process.exit(clean ? 0 : 1);
