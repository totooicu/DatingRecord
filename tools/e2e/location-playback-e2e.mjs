// 定位回放 e2e：地图页的「按时间 / 按点」回放、顺序/逆序、自动播放与步进。
//
// 验证：
//   P1 只有 ≥2 个点才出现回放卡；默认「按时间 + 顺序」，标题显示点区间
//   P2 按点自动播放：N 点/秒推进，停止后进度不再变
//   P3 步进：前进 / 后退各走 N 点，越界夹在首尾
//   P4 逆序：复位后从最后一点开始，前进/播放都向更早走
//   P5 按时间：N 秒记录/秒推进，走到头自动停（按钮回到「播放」）
//   P6 切换单位保留位置（时间 ↔ 点 不回到起点）
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
const btn = (name) => card().getByRole('button', { name, exact: true });
const headText = async () => (await card().locator('.loc-card-head span').innerText()).replace(/\s+/g, ' ').trim();
const pos = async () => {
  const m = /第 (\d+)\/(\d+) 点/.exec(await headText());
  return m ? Number(m[1]) : -1;
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
check('默认单位是「时间」', (await btn('时间').getAttribute('aria-pressed')) === 'true');
check('默认顺序是「顺序」', (await btn('顺序').getAttribute('aria-pressed')) === 'true');
const initialHead = await headText();
check('标题显示点数与时间区间', /共 20 点 · \d{2}:\d{2}:\d{2} → \d{2}:\d{2}:\d{2}/.test(initialHead), initialHead);

console.log('\nP2 按点自动播放');
await btn('点').click();
await card().getByLabel('每秒走多少个点').fill('5');
await card().getByLabel('每步前进多少个点').fill('2');
await btn('▶ 播放').click();
await p.waitForTimeout(900);
const playing1 = await pos();
await p.waitForTimeout(700);
const playing2 = await pos();
check('播放中序号前进', playing2 > playing1 && playing1 > 1, `${playing1} → ${playing2}`);
await btn('⏹ 停止').click();
const stopped = await headText();
await p.waitForTimeout(500);
check('停止后进度不再变', (await headText()) === stopped, stopped);
check('停止后按钮回到「播放」', (await btn('▶ 播放').count()) === 1);

console.log('\nP3 步进');
const beforeStep = await pos();
await btn('前进 ›').click();
const afterFwd = await pos();
check('前进走 2 个点', afterFwd === Math.min(N, beforeStep + 2), `${beforeStep} → ${afterFwd}`);
await btn('‹ 后退').click();
await btn('‹ 后退').click();
check('后退两次共退 4 个点', (await pos()) === Math.max(1, beforeStep - 2), `${afterFwd} → ${await pos()}`);
await btn('前进 ›').click();
check('再前进一次回到原处', (await pos()) === Math.min(N, beforeStep), String(await pos()));
for (let i = 0; i < 20; i += 1) await btn('‹ 后退').click();
check('越界夹在第一个点', (await pos()) === 1, String(await pos()));

console.log('\nP4 逆序');
await btn('逆序').click();
await btn('复位').click();
await btn('前进 ›').click();
check('逆序复位后从末尾往前', (await pos()) === N - 2, String(await pos()));
await btn('▶ 播放').click();
await p.waitForTimeout(700);
const revPos = await pos();
await btn('⏹ 停止').click();
check('逆序播放向更早走', revPos < N - 2, `${N - 2} → ${revPos}`);

console.log('\nP5 按时间');
await btn('顺序').click();
await btn('时间').click();
await btn('复位').click();
await card().getByLabel('每秒推进多少秒记录').fill('8');
await btn('▶ 播放').click();
await p.waitForTimeout(1100);
const t1 = await headText();
await p.waitForTimeout(1000);
const t2 = await headText();
check('按时间推进（序号变大）', (await pos()) > 1, `${t1} → ${t2}`);
// 提速到 400 秒/秒：38 秒的轨迹不到 0.2 秒走完，验证自动停
await card().getByLabel('每秒推进多少秒记录').fill('400');
await p.waitForTimeout(1200);
const atEnd = await pos();
check('走到末尾自动停', (await btn('▶ 播放').count()) === 1 && atEnd === N, `${atEnd}/${N}`);
check('末点时间正确', /10:00:38/.test(await headText()), await headText());

console.log('\nP6 切换单位保留位置');
await btn('复位').click();
await btn('前进 ›').click();
await btn('前进 ›').click();
const idxBefore = await pos();
await btn('点').click();
check('时间 → 点 仍是同一个点', (await pos()) === idxBefore, `${idxBefore} → ${await pos()}`);
await btn('时间').click();
check('点 → 时间 仍是同一个点', (await pos()) === idxBefore, `${idxBefore} → ${await pos()}`);

await p.screenshot({ path: path.join(TMP, 'playback.png') });
console.log(`\n截图：${path.join(TMP, 'playback.png')}`);

await browser.close();
if (failures.length) {
  console.log(`\n✗ ${failures.length} 项失败：${failures.join('、')}`);
  process.exit(1);
}
console.log('\n✓ 全部通过');
