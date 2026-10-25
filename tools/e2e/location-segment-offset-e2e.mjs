// 定位面板三项改进 e2e：
//   E1 折线方向箭头：地图轨迹上有旋转三角，点数多时均摊数量
//   E2 选中点追踪最新：选中的是最后一个点时，新打点自动跟着选中（地图跟随）
//   E3 分段位置修正：对任意点修正，从该点起到下一个锚点前生效
//      （用户原例：100 个点，选 5 / 20 / 60 填三段 → 修正 5-19、20-59、60-100，
//        第 1-4 个点不受影响；原始点始终不动）
//
// 依赖：`pnpm build` 后用静态服务器起 dist，再装 playwright。
// 用法：node tools/e2e/location-segment-offset-e2e.mjs [url]

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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-locseg-'));

const failures = [];
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures.push(label);
};

// 100 个点，沿对角线匀速展开：第 i 个点（0 基）lat = 31 + i*0.001
const N = 100;
const rawLat = (i) => (31.0 + i * 0.001).toFixed(6);
const rawLng = (i) => (121.0 + i * 0.001).toFixed(6);
/** 1 基点号 n 应用偏移 d 后的显示坐标 */
const shown = (n, d) => ({
  lat: (31.0 + (n - 1) * 0.001 + (d ? d.lat : 0)).toFixed(6),
  lng: (121.0 + (n - 1) * 0.001 + (d ? d.lng : 0)).toFixed(6),
});

// 用户原例的三段修正：点 5 / 20 / 60（1 基）→ 0 基 fromIndex 4 / 19 / 59
const SEG1 = { fromIndex: 4, lat: 0.001, lng: 0.002 };
const SEG2 = { fromIndex: 19, lat: 0.003, lng: 0.004 };
const SEG3 = { fromIndex: 59, lat: -0.001, lng: 0.0005 };

const segFile = path.join(TMP, '百分轨迹.drloc');
fs.writeFileSync(
  segFile,
  JSON.stringify({
    format: 'dr.location',
    version: 1,
    name: '百分轨迹',
    offset: { lat: 0, lng: 0 },
    points: Array.from({ length: N }, (_, i) => ({
      ts: new Date(Date.UTC(2026, 3, 1, 0, 0, i)).toISOString(),
      lat: 31.0 + i * 0.001,
      lng: 121.0 + i * 0.001,
      accuracy: 5,
      note: '',
    })),
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  }),
);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['geolocation'],
  geolocation: { latitude: 31.24, longitude: 121.21 },
});
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

/** 从 IndexedDB 的 blobs 里取出所有定位文件正文 */
const locationBlobs = () =>
  p.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('dating-record', 3);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const all = await new Promise((res, rej) => {
      const t = db.transaction('blobs', 'readonly');
      const r = t.objectStore('blobs').getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
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

const docOf = async (name) => (await locationBlobs()).map((t) => JSON.parse(t)).find((d) => d.name === name);

/** 记录页第 n 个点（1 基）那一行 */
const row = (n) => p.locator('.music-row').filter({ has: p.locator('.music-row-idx', { hasText: new RegExp(`^${n}$`) }) });

/** 选中第 n 个点：点记录行 → 自动跳到地图页 */
const selectPoint = async (n) => {
  await tab('记录').click();
  await p.waitForTimeout(400);
  await row(n).click();
  await p.waitForTimeout(600);
};

/** 在「从选中点起」范围里按度数填一段修正并保存 */
const saveSegment = async (n, off) => {
  await selectPoint(n);
  await tab('文件').click();
  await p.waitForTimeout(400);
  const segBtn = p.locator('.loc-scope', { hasText: '从选中点起' });
  if ((await segBtn.getAttribute('aria-pressed')) !== 'true') {
    await segBtn.click();
    await p.waitForTimeout(400);
  }
  if ((await p.locator('.loc-mode', { hasText: '度数' }).getAttribute('aria-pressed')) !== 'true') {
    await p.locator('.loc-mode', { hasText: '度数' }).click();
    await p.waitForTimeout(300);
  }
  await p.locator('.loc-offset input').nth(0).fill(String(off.lat));
  await p.locator('.loc-offset input').nth(1).fill(String(off.lng));
  await p.getByRole('button', { name: '保存修正' }).click();
  await p.waitForTimeout(1400);
};

console.log('\n=== 定位面板：箭头 / 选中追踪 / 分段修正 端到端 ===');

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
await p.locator('input[accept*="drloc"]').setInputFiles(segFile);
await p.waitForTimeout(2200);
check('导入 100 个点的文件', (await p.locator('.loc-list .music-row').count()) === N);

console.log('\nE3a 对第 5 个点修正（第一段）');
await saveSegment(5, SEG1);
let doc = await docOf('百分轨迹');
check(
  '文件写入第一段修正',
  !!doc && doc.offsets.length === 1 && doc.offsets[0].fromIndex === SEG1.fromIndex &&
    doc.offsets[0].lat === SEG1.lat && doc.offsets[0].lng === SEG1.lng,
  doc ? JSON.stringify(doc.offsets) : 'missing',
);
check('整份 offset 仍是 0', !!doc && doc.offset.lat === 0 && doc.offset.lng === 0);
check(
  '原始点没有被改写',
  !!doc && doc.points.length === N && doc.points[0].lat === 31.0 && doc.points[4].lat === 31.004 && doc.points[99].lat === 31.099,
);
await tab('记录').click();
await p.waitForTimeout(400);
const listText1 = await p.locator('.loc-list').innerText();
check('第 1 个点不受影响', listText1.includes(`${rawLat(0)},${rawLng(0)}`), listText1.slice(0, 120));
check('第 4 个点不受影响', listText1.includes(`${rawLat(3)},${rawLng(3)}`));
check(
  '第 5 个点已按段平移',
  listText1.includes(`${shown(5, SEG1).lat},${shown(5, SEG1).lng}`),
  shown(5, SEG1).lat,
);
check(
  '最后一个点（100）也在段里',
  listText1.includes(`${shown(N, SEG1).lat},${shown(N, SEG1).lng}`),
  shown(N, SEG1).lat,
);

console.log('\nE3b 再对第 20 / 60 个点修正（用户原例：5-19 / 20-59 / 60-100）');
await saveSegment(20, SEG2);
await saveSegment(60, SEG3);
doc = await docOf('百分轨迹');
check(
  '文件写入三段修正',
  !!doc && doc.offsets.length === 3 &&
    doc.offsets[0].fromIndex === 4 && doc.offsets[1].fromIndex === 19 && doc.offsets[2].fromIndex === 59,
  doc ? JSON.stringify(doc.offsets) : 'missing',
);
check(
  '原始点依然没动',
  !!doc && doc.points.length === N && doc.points[0].lat === 31.0 && doc.points[19].lat === 31.019,
);
await tab('记录').click();
await p.waitForTimeout(500);
const listText2 = await p.locator('.loc-list').innerText();
check('第 1-4 个点无偏移', listText2.includes(`${rawLat(0)},${rawLng(0)}`) && listText2.includes(`${rawLat(3)},${rawLng(3)}`));
check(
  '第 5-19 个点用第一段',
  listText2.includes(`${shown(5, SEG1).lat},${shown(5, SEG1).lng}`) &&
    listText2.includes(`${shown(19, SEG1).lat},${shown(19, SEG1).lng}`),
);
check(
  '第 20-59 个点用第二段',
  listText2.includes(`${shown(20, SEG2).lat},${shown(20, SEG2).lng}`) &&
    listText2.includes(`${shown(59, SEG2).lat},${shown(59, SEG2).lng}`),
);
check(
  '第 60-100 个点用第三段',
  listText2.includes(`${shown(60, SEG3).lat},${shown(60, SEG3).lng}`) &&
    listText2.includes(`${shown(N, SEG3).lat},${shown(N, SEG3).lng}`),
);
check(
  '区间边界没有串段（第 19 点不是第二段、第 20 点不是第一段）',
  !listText2.includes(`${shown(19, SEG2).lat},${shown(19, SEG2).lng}`) &&
    !listText2.includes(`${shown(20, SEG1).lat},${shown(20, SEG1).lng}`),
);

console.log('\nE3c 修正记录列表与锚点标记');
await tab('文件').click();
await p.waitForTimeout(400);
const segRows = p.locator('.loc-seg-row');
check('修正记录列出 3 段', (await segRows.count()) === 3);
const segText = await p.locator('.loc-seg-list').innerText();
check('区间显示「第 5–19 / 20–59 / 60–100 个点」', segText.includes('第 5–19 个点') && segText.includes('第 20–59 个点') && segText.includes('第 60–100 个点'), segText.replace(/\n/g, ' | '));
await tab('记录').click();
await p.waitForTimeout(400);
check('锚点行带「修正起点」标记', (await p.locator('.loc-anchor-tag').count()) === 3);

console.log('\nE3d 删除中间段：20-59 继承更早的段');
await tab('文件').click();
await p.waitForTimeout(400);
await segRows.nth(1).locator('.loc-seg-btn', { hasText: '删除' }).click();
await p.waitForTimeout(1400);
doc = await docOf('百分轨迹');
check('文件里只剩两段', !!doc && doc.offsets.length === 2 && !doc.offsets.some((s) => s.fromIndex === 19));
await tab('记录').click();
await p.waitForTimeout(500);
const listText3 = await p.locator('.loc-list').innerText();
check(
  '第 20-59 个点回落成第一段的偏移',
  listText3.includes(`${shown(20, SEG1).lat},${shown(20, SEG1).lng}`) &&
    listText3.includes(`${shown(59, SEG1).lat},${shown(59, SEG1).lng}`),
);
check(
  '第 60 点起仍是第三段',
  listText3.includes(`${shown(60, SEG3).lat},${shown(60, SEG3).lng}`),
);

console.log('\nE1 折线方向箭头');
await tab('地图').click();
await p.waitForTimeout(1200);
const arrows = await p.evaluate(() =>
  Array.from(document.querySelectorAll('.loc-arrow')).map((el) => ({
    transform: el.style.transform,
    w: Math.round(el.getBoundingClientRect().width),
  })),
);
check('折线上有方向箭头', arrows.length > 0 && arrows.length <= 40, `共 ${arrows.length} 个`);
check('箭头带旋转角（轨迹朝东北，约 45°）', arrows.some((a) => /rotate\(4[0-9]/.test(a.transform)), JSON.stringify(arrows.slice(0, 3)));
check(
  '点位圆点不受箭头影响（100 个 pin + 0 蓝点）',
  (await p.locator('.leaflet-marker-icon .loc-pin').count()) === N,
);

console.log('\nE2 选中点追踪最新');
await selectPoint(N); // 选中最后一个点
await tab('记录').click();
await p.waitForTimeout(300);
check('选中行是最后一行', (await row(N).getAttribute('class'))?.includes('on'));
// 阈值 0 + 定时策略：每秒必然新增一个点
await p.locator('.loc-num').first().fill('0');
await p.locator('.loc-select').selectOption('fixed');
await p.waitForTimeout(400);
await p.getByRole('button', { name: '▶ 自动打点' }).click();
await p.waitForTimeout(4500);
const afterAuto = await p.locator('.loc-list .music-row').count();
check('自动打点新增了点', afterAuto > N, `${N} → ${afterAuto}`);
const firstRowClass = await p.locator('.loc-list .music-row').first().getAttribute('class');
check('选中跟随到最新点（第一行 = 最新，带 on）', !!firstRowClass && firstRowClass.includes('on'), firstRowClass || '');
const redPins = await p.evaluate(
  () =>
    Array.from(document.querySelectorAll('.leaflet-marker-icon .loc-pin')).filter(
      (d) => getComputedStyle(d).backgroundColor === 'rgb(229, 57, 53)',
    ).length,
);
check('地图上仍只有一个红点（选中）', redPins === 1, `${redPins} 个`);
await p.getByRole('button', { name: '⏹ 停止自动打点' }).click();
await p.waitForTimeout(600);

// 反向验证：选中的不是最后一点时，不跟随
await selectPoint(10);
await tab('记录').click();
await p.waitForTimeout(300);
await p.getByRole('button', { name: '▶ 自动打点' }).click();
await p.waitForTimeout(3500);
const oldSel = await row(10).getAttribute('class');
check('选中旧点时不跟随（第 10 行仍是 on）', !!oldSel && oldSel.includes('on'), oldSel || '');
await p.getByRole('button', { name: '⏹ 停止自动打点' }).click();
await p.waitForTimeout(600);

console.log('\nE3e 刷新后分段修正仍在');
await p.reload({ waitUntil: 'load' });
await waitBoot();
await p.waitForTimeout(800);
await toLocation();
await p.waitForTimeout(800);
check('刷新后恢复上次文件', (await p.locator('.loc-card-head', { hasText: '百分轨迹' }).count()) >= 1);
await tab('文件').click();
await p.waitForTimeout(500);
check('刷新后修正记录还在（2 段）', (await p.locator('.loc-seg-row').count()) === 2);
doc = await docOf('百分轨迹');
check(
  '刷新后文件里的两段不变',
  !!doc && doc.offsets.length === 2 && doc.offsets[0].fromIndex === 4 && doc.offsets[1].fromIndex === 59,
);

await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });

console.log('\n========== 汇总 ==========');
if (failures.length) {
  console.log(`${failures.length} 项失败：`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('全部通过 ✓');
