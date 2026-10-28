// 定位回放 e2e：地图页的「按时间 / 按点」回放、顺序/逆序、自动播放与步进。
//
// 验证：
//   P1 只有 ≥2 个点才出现回放卡；默认「按时间 + 顺序」，标题显示点区间
//   P2 按点自动播放：N 点/秒推进，停止后进度不再变
//   P3 步进：前进 / 后退各走 step 点，越界夹在首尾
//   P4 逆序：清除后从最后一点开始，前进/播放都向更早走
//   P5 按时间：N 秒记录/秒推进，走到头自动停（按钮回到「播放」）
//   P6 切换单位保留位置（时间 ↔ 点 不回到起点）
//   P7 拖进度条直接 seek 到任意点
//   P8 「更多」抽屉里的步长 chips 改变每步跨度
//   P9 「清除」按钮回到未激活态
//   P10 走到末尾自动停时按钮 label 变回「播放」
//
// 依赖：`pnpm build` 后用静态服务器起 dist，再装 playwright。
// 用法：node tools/e2e/location-playback-e2e.mjs [url]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const APP = process.argv[2] || 'http://localhost:4173/';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-playback-'));

const failures = [];
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures.push(label);
};

/** 20 个点、每点间隔 2 秒：总时长 38 秒，便于断言时间模式 */
const N = 20;
const STEP_MS = 2000;
const trackFile = path.join(TMP, '回放轨迹.drloc');
fs.writeFileSync(
  trackFile,
  JSON.stringify(
    {
      format: 'dr.location',
      version: 1,
      name: '回放轨迹',
      offset: { lat: 0, lng: 0 },
      points: Array.from({ length: N }, (_, i) => ({
        ts: new Date(Date.UTC(2026, 9, 20, 10, 0, (i * STEP_MS) / 1000)).toISOString(),
        lat: 30.2741 + i * 0.0002,
        lng: 120.1551 + i * 0.0003,
        accuracy: 5,
        note: '',
      })),
      createdAt: '2026-10-20T10:00:00.000Z',
      updatedAt: '2026-10-20T10:00:38.000Z',
    },
    null,
    2,
  ),
);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
const p = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

const waitBoot = async () => {
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );
};

const toSettingsRoot = async () => {
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.waitForTimeout(400);
  for (let i = 0; i < 4; i += 1) {
    if (await p.locator('.settings-nav-title').first().isVisible().catch(() => false)) return;
    const back = p.locator('.back-btn').first();
    if (!(await back.count())) return;
    await back.click();
    await p.waitForTimeout(300);
  }
};

const toLocation = async () => {
  await toSettingsRoot();
  await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: '定位' }).first().click();
  await p.waitForTimeout(1200);
};

const tab = (name) => p.locator('.loc-panel .aichat-tab', { hasText: name });
const card = () => p.locator('.loc-play');
/** 用 aria-label 定位回放卡内的按钮（不依赖可见符号文本） */
const tpBtn = (label) => card().getByRole('button', { name: label, exact: true });
/** 读回放卡头的进度文本（.loc-play-read） */
const headText = async () => (await card().locator('.loc-play-read').innerText()).replace(/\s+/g, ' ').trim();
/** 提取当前播放位置（1-based）：「第 X / N 点」 */
const pos = async () => {
  const m = /第 (\d+) \/ (\d+) 点/.exec(await headText());
  return m ? Number(m[1]) : -1;
};

/** 打开「更多」抽屉（如果还没开） */
const openMore = async () => {
  const more = card().locator('.loc-tp-more');
  if ((await more.getAttribute('aria-expanded')) !== 'true') {
    await more.click();
    await p.waitForTimeout(300);
  }
};

/** 在「更多」抽屉里点 segmented control 的某个按钮 */
const moreSegBtn = async (groupLabel, btnText) => {
  await openMore();
  const group = card().locator(`[role="group"][aria-label="${groupLabel}"]`);
  await group.getByRole('button', { name: btnText, exact: true }).click();
  await p.waitForTimeout(200);
};

/** 在「更多」抽屉里点步长 chip */
const moreStepChip = async (label) => {
  await openMore();
  const group = card().locator('[role="group"][aria-label="步进大小"]');
  await group.getByRole('button', { name: label, exact: true }).click();
  await p.waitForTimeout(200);
};

/** 在速度 chips 里点某个档位 */
const rateChip = async (label) => {
  const group = card().locator('[role="group"][aria-label="播放速度"]');
  await group.getByRole('button', { name: label, exact: true }).click();
  await p.waitForTimeout(200);
};

console.log('\n=== 定位回放 端到端 ===');

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(2500);
}

await toLocation();
console.log('\nP1 回放卡');
check('导入前没有回放卡（没有定位文件）', (await card().count()) === 0);

await tab('文件').click();
await p.waitForTimeout(400);
await p.getByRole('button', { name: '导入 .drloc / 旧 CSV' }).click();
await p.locator('input[accept*="drloc"]').setInputFiles(trackFile);
await p.waitForTimeout(1200);
await tab('地图').click();
await p.waitForTimeout(600);

check('导入后出现回放卡', (await card().count()) === 1);
const latestSpeedText = await p.locator('.loc-current-speed').innerText();
const maxSpeedText = await p.locator('.loc-max-speed').innerText();
check('显示最新段速度与轨迹最大速度', /当前速度：.*km\/h/.test(latestSpeedText) && /最高速度（红色）：.*km\/h/.test(maxSpeedText));
check('图例从蓝到红', await p.locator('.loc-speedbar').evaluate(el => {
  const bg = el.style.background;
  return bg.indexOf('37, 99, 235') >= 0 && bg.indexOf('239, 68, 68') > bg.indexOf('37, 99, 235');
}));
for (const width of [390, 820, 1440]) {
  await p.setViewportSize({ width, height: 900 });
  check(`速度图例 ${width}px 不横向溢出`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
}
await p.setViewportSize({ width: 390, height: 900 });
// 默认单位/顺序在「更多」抽屉里
await openMore();
check('默认单位是「时间」', (await card().locator('[role="group"][aria-label="回放单位"] button[aria-pressed="true"]').innerText()).trim() === '时间');
check('默认顺序是「顺序」', (await card().locator('[role="group"][aria-label="播放顺序"] button[aria-pressed="true"]').innerText()).trim() === '顺序');
const initialHead = await headText();
check('标题显示点数与时间区间', /共 20 点 · \d{2}:\d{2}:\d{2} → \d{2}:\d{2}:\d{2}/.test(initialHead), initialHead);

console.log('\nP2 按点自动播放');
await moreSegBtn('回放单位', '点');
// 速度 chips 现在显示点模式：「1 点/s」「2 点/s」「5 点/s」…
await rateChip('5 点/s');
// 步长 chips 在「更多」里：默认 1 点，改成 5 点便于 P3 断言
await moreStepChip('5 点');
await tpBtn('播放').click();
await p.waitForTimeout(900);
const playing1 = await pos();
await p.waitForTimeout(700);
const playing2 = await pos();
check('播放中序号前进', playing2 > playing1 && playing1 > 1, `${playing1} → ${playing2}`);
// 停止 = 再点同一个按钮（此时 label 是「暂停」）
await tpBtn('暂停').click();
const stopped = await headText();
await p.waitForTimeout(500);
check('停止后进度不再变', (await headText()) === stopped, stopped);
check('停止后按钮回到「播放」', (await tpBtn('播放').count()) === 1);

console.log('\nP3 步进（步长=5 点）');
const beforeStep = await pos();
await tpBtn('前进一步').click();
const afterFwd = await pos();
check('前进走 5 个点', afterFwd === Math.min(N, beforeStep + 5), `${beforeStep} → ${afterFwd}`);
await tpBtn('后退一步').click();
check('后退一次退 5 个点', (await pos()) === Math.max(1, beforeStep), `${afterFwd} → ${await pos()}`);
// 连续后退直到夹住
for (let i = 0; i < 20; i += 1) await tpBtn('后退一步').click();
check('越界夹在第一个点', (await pos()) === 1, String(await pos()));
check('回放首点没有上一段速度', (await p.locator('.loc-current-speed').innerText()).includes('未知'));
check('回放不改变全轨迹最高速度', (await p.locator('.loc-max-speed').innerText()) === maxSpeedText);

console.log('\nP4 逆序');
await moreSegBtn('播放顺序', '逆序');
// 先清除（回到未激活），再在逆序下步进
await tpBtn('清除').click();
await p.waitForTimeout(300);
check('清除后回到未激活态（显示「共 N 点」）', /共 20 点/.test(await headText()), await headText());
check('清除后「清除」按钮消失', (await tpBtn('清除').count()) === 0);
// 逆序 + 未激活 → 游标在末尾（index 19）；前进一步 = 往回走 5 点 → index 14 → 显示第 15
await tpBtn('前进一步').click();
const revAfterStep = await pos();
check('逆序清除后前进 = 从末尾往回走', revAfterStep === N - 5, `${revAfterStep} (期望 ${N - 5})`);
// 逆序播放
await rateChip('5 点/s');
await tpBtn('播放').click();
await p.waitForTimeout(700);
const revPos = await pos();
await tpBtn('暂停').click();
check('逆序播放向更早走', revPos < revAfterStep, `${revAfterStep} → ${revPos}`);

console.log('\nP5 按时间');
await moreSegBtn('播放顺序', '顺序');
await moreSegBtn('回放单位', '时间');
await tpBtn('清除').click();
await p.waitForTimeout(200);
// 自定义速度：在「更多」抽屉里填数字框
await openMore();
await card().getByLabel('每秒推进多少秒记录').fill('8');
await p.waitForTimeout(200);
await tpBtn('播放').click();
await p.waitForTimeout(1100);
const t1 = await headText();
await p.waitForTimeout(1000);
const t2 = await headText();
check('按时间推进（序号变大）', (await pos()) > 1, `${t1} → ${t2}`);
// 提速到 400 秒/秒：38 秒的轨迹不到 0.2 秒走完，验证自动停
await openMore();
await card().getByLabel('每秒推进多少秒记录').fill('400');
await p.waitForTimeout(200);
// 如果播放中，先等它跑完；如果已停，直接检查
await p.waitForTimeout(1500);
const atEnd = await pos();
check('走到末尾自动停', (await tpBtn('播放').count()) === 1 && atEnd === N, `${atEnd}/${N}`);
check('末点时间正确', /10:00:38/.test(await headText()), await headText());

console.log('\nP6 切换单位保留位置');
await tpBtn('清除').click();
await p.waitForTimeout(200);
await tpBtn('前进一步').click();
await tpBtn('前进一步').click();
const idxBefore = await pos();
await moreSegBtn('回放单位', '点');
check('时间 → 点 仍是同一个点', (await pos()) === idxBefore, `${idxBefore} → ${await pos()}`);
await moreSegBtn('回放单位', '时间');
check('点 → 时间 仍是同一个点', (await pos()) === idxBefore, `${idxBefore} → ${await pos()}`);

console.log('\nP7 拖进度条 seek');
// 先清除回到未激活，再 seek
await tpBtn('清除').click();
await p.waitForTimeout(200);
// 拖到第 10 个点（0-based index = 10）
await p.evaluate(() => {
  const input = document.querySelector('.loc-scrub');
  if (!input) throw new Error('no .loc-scrub');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '10');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForTimeout(400);
const scrubPos = await pos();
check('拖条 seek 到第 11 个点（0-based=10）', scrubPos === 11, `pos=${scrubPos}`);
// 拖条的 aria-label 正确
const scrubLabel = await card().locator('.loc-scrub').getAttribute('aria-label');
check('拖条 aria-label 正确', scrubLabel === '回放进度：拖动直接看到那一段', scrubLabel);

console.log('\nP8 步长 chips 改变每步跨度');
await tpBtn('清除').click();
await p.waitForTimeout(200);
await moreSegBtn('回放单位', '点');
// 先显式设步长=1（之前 P2 设过 5，清除不会重置步长）
await moreStepChip('1 点');
await tpBtn('前进一步').click();
const step1Pos = await pos();
check('步长=1 时前进一步', step1Pos === 2, `pos=${step1Pos}`);
// 改步长为 20 点
await moreStepChip('20 点');
await tpBtn('前进一步').click();
const step20Pos = await pos();
check('步长=20 时前进一步跨 20 点', step20Pos === Math.min(N, step1Pos + 20), `${step1Pos} → ${step20Pos}`);

console.log('\nP9 清除按钮');
// 先激活回放
await tpBtn('前进一步').click();
check('步进后出现「清除」按钮', (await tpBtn('清除').count()) === 1);
await tpBtn('清除').click();
await p.waitForTimeout(300);
check('清除后回到未激活态', /共 20 点/.test(await headText()), await headText());
check('清除后「清除」按钮消失', (await tpBtn('清除').count()) === 0);

console.log('\nP10 走到末尾自动停时按钮 label 变回「播放」');
await moreSegBtn('回放单位', '时间');
await openMore();
await card().getByLabel('每秒推进多少秒记录').fill('900');
await p.waitForTimeout(200);
await tpBtn('播放').click();
// 等待自动停止
await p.waitForTimeout(2000);
check('到末尾后按钮 label 变回「播放」', (await tpBtn('播放').count()) === 1);
check('到末尾后「暂停」按钮不存在', (await tpBtn('暂停').count()) === 0);

console.log('\nP11 记录里的「在记录里定位」必须真把那一行带进视野');
await tab('记录').click();
await p.waitForTimeout(400);
const firstRow = p.locator('ul.loc-list li[data-idx="0"]');
await firstRow.click(); // 点行 = 选中并跳到地图（既有行为）
await p.waitForTimeout(400);
const selCard = p.locator('.loc-card.loc-selected');
check('点行后跳到地图并选中该点', (await selCard.count()) === 1);
await selCard.getByRole('button', { name: '在记录里定位' }).click();
await p.waitForTimeout(300); // 定位是瞬时滚动，不用等 smooth 慢慢爬
check('回到记录页并出现选中条', (await p.locator('.loc-sel-bar').count()) === 1);
const rb = await firstRow.boundingBox();
const vh = await p.evaluate(() => window.innerHeight);
check('那一行被滚进了视野', !!rb && rb.y > 0 && rb.y < vh, rb ? `y=${Math.round(rb.y)} / 视口 ${vh}` : '无');
check('那一行带高亮 class', /loc-row-flash/.test((await firstRow.getAttribute('class')) || ''));

await p.screenshot({ path: path.join(TMP, 'playback.png') });
console.log(`\n截图：${path.join(TMP, 'playback.png')}`);

await browser.close();
if (failures.length) {
  console.log(`\n✗ ${failures.length} 项失败：${failures.join('、')}`);
  process.exit(1);
}
console.log('\n✓ 全部通过');
