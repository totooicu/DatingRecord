// 定位地图页「一屏放得下」e2e：回放 / 选中的点 用一颗分段切换 + 选中点可就地删除。
//
// 覆盖：
//   M1 一屏：390×844 与 390×700 两种视口下，图例 + 地图 + 切换条 + 一张卡 + 底部动作
//      全在视口里（.pane 的 scrollHeight === clientHeight，无需滚动）；
//      视口变矮时地图自己让位（高度严格变小），而不是把卡片顶出屏幕
//   M2 图例收成一条可横向滑的行（高度 ≤ 24，内容 scrollWidth > 容器 clientWidth）
//   M3 分段切换：默认显示回放卡；切到「选中」时回放卡整块消失；
//      来回切不丢播放位置（滑条拖到第 7 点 → 切走 → 切回仍是第 7 点）
//   M4 在记录里点某一行选中一个点 → 自动切到「选中」，分段按钮标签跟着带序号
//   M5 在地图上点那个点（选中后地图正好把它渲在中心）→ 同样自动切到「选中」
//   M6 「删除该点」两步内联确认：确认后点数 −1、选中清空、卡片回落成提示、toast 报剩余
//   M7 删点不会让分段修正错位：从第 5 点起的修正，删掉第 2 个点之后锚点前移到第 4 点，
//      同一批原始点看到的坐标不变（核心 removePoint 会重排 doc.offsets）
//
// 依赖：`npm run build` 后用静态服务器起 dist（本脚本不 import 源码，preview 就够），
//       再装全局 playwright；缺浏览器时退回 /usr/bin/chromium。
// 用法：node tools/e2e/location-map-switch-e2e.mjs [url]   默认 http://localhost:4173/

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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-loswitch-'));

const failures = [];
const errors = [];
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures.push(label);
};

// 12 个点，沿对角线匀速展开：第 i 个点（0 基）lat/lng = 31/121 + i*0.001
const N = 12;
const raw = (i0) => ({ lat: (31 + i0 * 0.001).toFixed(6), lng: (121 + i0 * 0.001).toFixed(6) });
/** 应用了某段偏移后的显示坐标 */
const shown = (i0, off) => ({
  lat: (31 + i0 * 0.001 + (off?.lat ?? 0)).toFixed(6),
  lng: (121 + i0 * 0.001 + (off?.lng ?? 0)).toFixed(6),
});
const trackFile = path.join(TMP, '十二点轨迹.drloc');
fs.writeFileSync(
  trackFile,
  JSON.stringify(
    {
      format: 'dr.location',
      version: 1,
      name: '十二点轨迹',
      offset: { lat: 0, lng: 0 },
      points: Array.from({ length: N }, (_, i) => ({
        ts: new Date(Date.UTC(2026, 4, 10, 8, 0, i * 30)).toISOString(),
        ...raw(i),
        accuracy: 5,
        note: '',
      })),
      createdAt: '2026-05-10T08:00:00.000Z',
      updatedAt: '2026-05-10T08:06:00.000Z',
    },
    null,
    2,
  ),
);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
});
p.on('dialog', (d) => d.accept()); // 记录列表里的 × 仍走原生 confirm

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
const segBtn = (label) => p.locator('.loc-map-switch .theme-mode-btn', { hasText: label });
const segPressed = () =>
  p.evaluate(() =>
    [...document.querySelectorAll('.loc-map-switch .theme-mode-btn')]
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.textContent.trim()),
  );
/** 地图那块面板自己滚不滚得动：scrollHeight 与 clientHeight 相等 = 一屏装得下 */
const paneOverflow = () =>
  p.evaluate(() => {
    const e = document.querySelector('.loc-panel')?.closest('.pane');
    if (!e) return null;
    return { over: e.scrollHeight - e.clientHeight, clientH: e.clientHeight };
  });
const box = (sel) =>
  p.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    return r ? { top: Math.round(r.top), h: Math.round(r.height), bottom: Math.round(r.bottom) } : null;
  }, sel);
/** 回放卡头上的「第 X / N 点」 */
const playPos = async () => {
  const t = (await p.locator('.loc-play-read').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const m = /第 (\d+) \/ (\d+) 点/.exec(t);
  return m ? Number(m[1]) : -1;
};
/** 记录页第 n 行（1 基）显示的坐标文本 */
const rowCoord = async (n) => {
  const r = p.locator('.music-row').filter({ has: p.locator('.music-row-idx', { hasText: new RegExp(`^${n}$`) }) });
  const t = await r.innerText().catch(() => '');
  return t.replace(/\s+/g, ' ');
};
/** 从 IndexedDB 取出定位文件正文（验证 doc.offsets 真的被重排） */
const docOf = async (name) => {
  const blobs = await p.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('dating-record', 3);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const all = await new Promise((res, rej) => {
      const t = db.transaction('blobs', 'readonly');
      const q = t.objectStore('blobs').getAll();
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const out = [];
    for (const b of all) {
      try {
        const text = await b.text();
        if (text.includes('"dr.location"')) out.push(text);
      } catch {
        /* 非文本附件 */
      }
    }
    return out;
  });
  return blobs.map((t) => JSON.parse(t)).find((d) => d.name === name);
};
/** 选中第 n 个点（1 基）：在记录页点那一行，会自动跳回地图 */
const selectViaList = async (n) => {
  await tab('记录').click();
  await p.waitForTimeout(400);
  await p.locator('.music-row')
    .filter({ has: p.locator('.music-row-idx', { hasText: new RegExp(`^${n}$`) }) })
    .click();
  await p.waitForTimeout(700);
};

console.log(`\n=== 定位地图：回放 / 选中 一键切换 + 删除该点（${APP}）===`);

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(2500);
}
await toLocation();
await tab('文件').click();
await p.waitForTimeout(300);
await p.getByRole('button', { name: '导入 .drloc / 旧 CSV' }).click();
await p.locator('input[accept*="drloc"]').setInputFiles(trackFile);
await p.waitForTimeout(2200);
await tab('地图').click();
await p.waitForTimeout(1200);

console.log('\nM2 图例收成一行');
{
  const legend = await box('.loc-legend');
  const geo = await p.evaluate(() => {
    const e = document.querySelector('.loc-legend');
    return { scrollW: e.scrollWidth, clientW: e.clientWidth };
  });
  check(`图例只有一行（高 ${legend?.h}，≤24）`, !!legend && legend.h <= 24, JSON.stringify(legend));
  check('图例可以横向滑（内容比容器宽）', geo.scrollW > geo.clientW, JSON.stringify(geo));
}

console.log('\nM3 分段切换与位置保留');
{
  check('默认显示回放卡、没有选中卡', !!(await box('.loc-play')) && (await box('.loc-selected')) === null);
  check('切换条两颗按钮都在', (await segBtn('回放').count()) === 1 && (await segBtn('选中').count()) === 1);
  await p.locator('.loc-scrub').fill('7'); // 0 基：拖到第 8 个点
  await p.waitForTimeout(400);
  const before = await playPos();
  check('拖进度条到第 8 个点', before === 8, `实际 ${before}`);
  await segBtn('选中').click();
  await p.waitForTimeout(400);
  check('切到「选中」后回放卡整块消失', (await box('.loc-play')) === null);
  check('没有选中点时这里给的是提示文字，不是空卡', (await box('.loc-selected')) === null && (await p.locator('.loc-view .muted.small', { hasText: '点地图上的白芯小点' }).count()) === 1);
  await segBtn('回放').click();
  await p.waitForTimeout(400);
  const after = await playPos();
  check(`切回来播放位置没丢（仍第 ${after} 点）`, after === before, `${before} → ${after}`);
}

console.log('\nM1 一屏装得下（两种视口）');
{
  const tall = await paneOverflow();
  check(`844 高时回放态不用滚动（超出 ${tall?.over}px）`, tall && tall.over === 0, JSON.stringify(tall));
  const mapTall = await box('.loc-map');
  await segBtn('选中').click();
  await selectViaList(4);
  const tallSel = await paneOverflow();
  check(`844 高时选中态也不用滚动（超出 ${tallSel?.over}px）`, tallSel && tallSel.over === 0, JSON.stringify(tallSel));
  await p.setViewportSize({ width: 390, height: 700 });
  await p.waitForTimeout(700);
  const short = await paneOverflow();
  check(`700 高时仍不用滚动（超出 ${short?.over}px）`, short && short.over === 0, JSON.stringify(short));
  const mapShort = await box('.loc-map');
  check(
    `视口变矮时地图让位（${mapTall?.h} → ${mapShort?.h}），不是把卡片顶出屏幕`,
    !!mapTall && !!mapShort && mapShort.h < mapTall.h,
    JSON.stringify({ mapTall, mapShort }),
  );
  const playBottom = (await box('.loc-play'))?.bottom ?? (await box('.loc-selected'))?.bottom;
  check(`卡片底边在视口内（${playBottom} ≤ 638）`, playBottom != null && playBottom <= 700 - 62, String(playBottom));
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(700);
}

console.log('\nM4 记录里选中 → 自动切到「选中」');
{
  const on = await segPressed();
  check('选中卡正在显示', on.length === 1 && on[0].startsWith('选中 4'), JSON.stringify(on));
  const head = await p.locator('.loc-selected .loc-card-head').innerText();
  check('选中卡头写的是第 4 / 12 个', /第 4 \/ 12 个/.test(head.replace(/\s+/g, ' ')), head.replace(/\s+/g, ' '));
  check('选中卡里有「删除该点」', (await p.locator('.loc-selected .loc-del-point').count()) === 1);
}

console.log('\nM5 地图上点那个点 → 同样自动切到「选中」');
{
  await segBtn('回放').click();
  await p.waitForTimeout(400);
  check('先手动切回回放', !!(await box('.loc-play')));
  // selectPoint 刚把地图 setView 到第 4 个点，所以那颗红心正好在容器中心
  const map = await p.evaluate(() => {
    const r = document.querySelector('.loc-map').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await p.mouse.click(map.x, map.y);
  await p.waitForTimeout(600);
  const on = await segPressed();
  check('点地图上的点也自动切到「选中」', on.length === 1 && on[0].startsWith('选中 4'), JSON.stringify(on));
}

console.log('\nM7 删点不让分段修正错位（先建一段修正）');
{
  await selectViaList(5);
  await tab('文件').click();
  await p.waitForTimeout(400);
  const scope = p.locator('.loc-scope', { hasText: '从选中点起' });
  if ((await scope.getAttribute('aria-pressed')) !== 'true') {
    await scope.click();
    await p.waitForTimeout(300);
  }
  const deg = p.locator('.loc-mode', { hasText: '度数' });
  if ((await deg.getAttribute('aria-pressed')) !== 'true') {
    await deg.click();
    await p.waitForTimeout(300);
  }
  await p.locator('.loc-offset input').nth(0).fill('0.002');
  await p.locator('.loc-offset input').nth(1).fill('-0.001');
  await p.getByRole('button', { name: '保存修正' }).click();
  await p.waitForTimeout(1400);
  const doc1 = await docOf('十二点轨迹');
  check(
    '修正在第 5 个点起锚（0 基 fromIndex=4）',
    !!doc1 && doc1.offsets.length === 1 && doc1.offsets[0].fromIndex === 4 && doc1.offsets[0].lat === 0.002 && doc1.offsets[0].lng === -0.001,
    doc1 ? JSON.stringify(doc1.offsets) : 'missing',
  );
  await tab('记录').click();
  await p.waitForTimeout(400);
  check('第 4 个点不受影响', (await rowCoord(4)).includes(`${raw(3).lat},${raw(3).lng}`), await rowCoord(4));
  check('第 5 个点已按段平移', (await rowCoord(5)).includes(`${shown(4, { lat: 0.002, lng: -0.001 }).lat},${shown(4, { lat: 0.002, lng: -0.001 }).lng}`), await rowCoord(5));

  // 删掉第 2 个点（在段之前），锚点应跟着前移一位，作用域还是同一批原始点
  await selectViaList(2);
  await p.locator('.loc-selected .loc-del-point').click();
  await p.waitForTimeout(300);
  await p.locator('.loc-selected .confirm-acts .btn-danger', { hasText: '确认' }).click();
  await p.waitForTimeout(1600);
  const doc2 = await docOf('十二点轨迹');
  check(
    '删点后 doc.offsets 的锚点跟着前移（4 → 3）',
    !!doc2 && doc2.points.length === N - 1 && doc2.offsets.length === 1 && doc2.offsets[0].fromIndex === 3,
    doc2 ? `${doc2.points.length} 点 / ${JSON.stringify(doc2.offsets)}` : 'missing',
  );
  await tab('记录').click();
  await p.waitForTimeout(500);
  check('第 3 个点仍不受影响（原第 4 个点）', (await rowCoord(3)).includes(`${raw(3).lat},${raw(3).lng}`), await rowCoord(3));
  check('第 4 个点开始受修正（原第 5 个点）', (await rowCoord(4)).includes(`${shown(4, { lat: 0.002, lng: -0.001 }).lat},${shown(4, { lat: 0.002, lng: -0.001 }).lng}`), await rowCoord(4));
  check('「修正起点」标记也跟着挪到第 4 行', (await rowCoord(4)).includes('修正起点'), await rowCoord(4));
}

console.log('\nM6 删除该点：两步内联确认');
{
  await selectViaList(6);
  const rowsBefore = await p.locator('.loc-list .music-row').count();
  // M7 已经删过一个点，所以这里不能按「原始第 6 个点」硬编码坐标：
  // 先把文件里的点数组抄下来，删完再比对「去掉第 6 项」是否严丝合缝。
  const docBefore = await docOf('十二点轨迹');
  const delIdx = 5; // 记录页第 6 行 = 0 基下标 5
  const expectAfter = (docBefore?.points ?? []).filter((_, i) => i !== delIdx);
  const triple = (q) => [q.ts, q.lat, q.lng];
  await p.locator('.loc-selected .loc-del-point').click();
  await p.waitForTimeout(300);
  check('点一下先只出现确认条，没有立刻删', (await p.locator('.loc-selected .confirm-row').count()) === 1 && (await p.locator('.loc-list .music-row').count()) === rowsBefore);
  await p.locator('.loc-selected .confirm-acts .btn-ghost', { hasText: '取消' }).click();
  await p.waitForTimeout(300);
  check('取消后点数不变、确认条收起', (await p.locator('.loc-list .music-row').count()) === rowsBefore && (await p.locator('.loc-selected .confirm-row').count()) === 0);
  await p.locator('.loc-selected .loc-del-point').click();
  await p.waitForTimeout(300);
  await p.locator('.loc-selected .confirm-acts .btn-danger', { hasText: '确认' }).click();
  await p.waitForTimeout(1600);
  const rowsAfter = await p.locator('.loc-list .music-row').count();
  check(`确认后少了一个点（${rowsBefore} → ${rowsAfter}）`, rowsAfter === rowsBefore - 1, String(rowsAfter));
  const toastText = (await p.locator('.toast').last().innerText().catch(() => '')).replace(/\s+/g, ' ');
  check(`toast 报的是剩余点数（${rowsAfter}）`, toastText.includes(`剩 ${rowsAfter} 个点`), toastText);
  const on = await segPressed();
  check('删掉的正是选中的那个：选中清空、标签回到「选中」', on.length === 1 && on[0] === '选中', JSON.stringify(on));
  check('选中卡换成提示文字', (await box('.loc-selected')) === null);
  const doc = await docOf('十二点轨迹');
  const same =
    !!doc &&
    doc.points.length === rowsAfter &&
    expectAfter.length > 0 &&
    JSON.stringify(doc.points.map(triple)) === JSON.stringify(expectAfter.map(triple));
  check(
    `文件里也真的少了一个点，且少的是选中的第 6 行（${docBefore?.points.length} → ${doc?.points.length} 点）`,
    same,
    doc ? JSON.stringify(doc.points.map((q) => q.lat)) : 'missing',
  );
}

console.log(`\n========== 汇总 ==========`);
console.log(`失败 ${failures.length} 项${failures.length ? `：${failures.join(' / ')}` : ''}`);
console.log(`控制台 / 页面错误 ${errors.length} 项${errors.length ? `：${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
if (failures.length || errors.length) process.exit(1);
console.log('\n全部通过 ✓');
