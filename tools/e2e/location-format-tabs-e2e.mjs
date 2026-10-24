// 定位文件（.drloc）+ 分段页 e2e。
//
// 验证：
//   D1 定位页四个分段（地图 / 记录 / 文件 / 说明）可切换
//   D2 新建 .drloc：文件进库、页面回到记录页
//   D3 导入带 offset 的 .drloc：列表显示修正后的坐标，原文仍是原始坐标
//   D4 地图配色 / 尺寸：历史点黄色、当前蓝点、选中红点，直径 = 2×线宽（8px）
//   D5 改偏移写回文件：坐标整体平移，刷新后恢复；原始点不被改写
//   D6 文件库按「定位」筛选、类型徽标与预览
//   D7 旧 CSV 导入后转成 .drloc
//
// 依赖：`pnpm build` 后用静态服务器起 dist（任选），再装 playwright。
// 用法：node tools/e2e/location-format-tabs-e2e.mjs [url]

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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-location-'));

const failures = [];
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures.push(label);
};

const raw1 = { lat: 31.2304, lng: 121.4737 };
const raw2 = { lat: 31.231, lng: 121.4745 };
const offset1 = { lat: 0.001, lng: 0.002 };
const offset2 = { lat: 0.002, lng: 0.003 };

const importFile = path.join(TMP, '偏移轨迹.drloc');
fs.writeFileSync(
  importFile,
  JSON.stringify(
    {
      format: 'dr.location',
      version: 1,
      name: '偏移轨迹',
      offset: offset1,
      points: [
        { ts: '2026-01-01T08:00:00.000Z', lat: raw1.lat, lng: raw1.lng, accuracy: 5, note: '起点' },
        { ts: '2026-01-01T08:01:00.000Z', lat: raw2.lat, lng: raw2.lng, accuracy: 8, note: '终点' },
      ],
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-01-01T08:01:00.000Z',
    },
    null,
    2,
  ),
);

const csvFile = path.join(TMP, 'legacy.csv');
fs.writeFileSync(
  csvFile,
  'ts,lat,lng,accuracy,note\n2026-02-01T10:00:00.000Z,30.1001,120.2002,6,旧数据\n',
);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['geolocation'],
  geolocation: { latitude: 31.2304, longitude: 121.4737 },
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

const markerInfo = () =>
  p.evaluate(() =>
    Array.from(document.querySelectorAll('.leaflet-marker-icon')).map((el) => {
      const dot = el.firstElementChild;
      const box = dot.getBoundingClientRect();
      return {
        color: getComputedStyle(dot).backgroundColor,
        w: Math.round(box.width),
        h: Math.round(box.height),
      };
    }),
  );

const YELLOW = 'rgb(255, 193, 7)';
const BLUE = 'rgb(33, 150, 243)';
const RED = 'rgb(229, 57, 53)';

console.log('\n=== 定位 .drloc / 分段页 端到端 ===');

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(2500);
}

console.log('\nD1 分段页');
await toLocation();
check('定位页有四个分段', (await p.locator('.loc-panel .aichat-tab').count()) === 4);
check(
  '分段文案正确',
  (await p.locator('.loc-panel .aichat-tab').allTextContents()).map((s) => s.trim()).join(' / ') === '地图 / 记录 / 文件 / 说明',
);
check('默认停在地图', !(await p.locator('.loc-panel .loc-view').first().getAttribute('hidden')));

console.log('\nD2 新建 .drloc');
await tab('文件').click();
await p.waitForTimeout(400);
await p.locator('input[placeholder*="新文件名"]').fill('E2E 空轨迹');
await p.getByRole('button', { name: '新建', exact: true }).click();
await p.waitForTimeout(1200);
check('新建后自动切到记录页', !(await p.locator('.loc-panel .loc-view').nth(1).getAttribute('hidden')));
check('记录页显示新文件名', (await p.locator('.loc-card-head', { hasText: 'E2E 空轨迹' }).count()) >= 1);

console.log('\nD3 导入带偏移的 .drloc');
await tab('文件').click();
await p.waitForTimeout(300);
await p.getByRole('button', { name: '导入 .drloc / 旧 CSV' }).click();
await p.locator('input[accept*="drloc"]').setInputFiles(importFile);
await p.waitForTimeout(1600);
check('导入后记录页显示「偏移轨迹」', (await p.locator('.loc-card-head', { hasText: '偏移轨迹' }).count()) >= 1);
check('记录页有 2 个点', (await p.locator('.loc-list .music-row').count()) === 2);
const listText = await p.locator('.loc-list').innerText();
check(
  '列表坐标 = 原始 + 文件偏移',
  listText.includes('31.231400,121.475700') && listText.includes('31.232000,121.476500'),
  listText.replace(/\n/g, ' | ').slice(0, 160),
);
const blobs = await locationBlobs();
const imported = blobs.map((t) => JSON.parse(t)).find((d) => d.name === '偏移轨迹');
check('文件里记录了 offset', !!imported && imported.offset.lat === offset1.lat && imported.offset.lng === offset1.lng);
check(
  '文件里的点仍是原始坐标',
  !!imported && imported.points[0].lat === raw1.lat && imported.points[0].lng === raw1.lng && imported.points[0].note === '起点',
);

console.log('\nD3b 页内文件选择器');
await tab('文件').click();
await p.waitForTimeout(300);
await p.getByRole('button', { name: '选已有定位文件' }).click();
await p.waitForTimeout(800);
check('选择器只列定位文件', (await p.locator('.file-item').count()) === 2);
check(
  '选择器里的类型都是「定位」',
  (await p.locator('.file-item .file-type').allTextContents()).every((s) => s.trim() === '定位'),
);
await p.locator('.file-item', { hasText: 'E2E 空轨迹.drloc' }).getByRole('button', { name: '打开' }).click();
await p.waitForTimeout(900);
check('打开已有文件后回到记录页', (await p.locator('.loc-card-head', { hasText: 'E2E 空轨迹' }).count()) >= 1);
check('打开的是空文件', (await p.locator('.loc-list .music-row').count()) === 0);
await tab('文件').click();
await p.waitForTimeout(300);
await p.getByRole('button', { name: '选已有定位文件' }).click();
await p.waitForTimeout(800);
await p.locator('.file-item', { hasText: '偏移轨迹.drloc' }).getByRole('button', { name: '打开' }).click();
await p.waitForTimeout(900);
check('切回带点的文件', (await p.locator('.loc-list .music-row').count()) === 2);

console.log('\nD4 地图配色与尺寸');
await tab('地图').click();
await p.waitForTimeout(900);
let marks = await markerInfo();
check('历史点全部是黄色', marks.length === 2 && marks.every((m) => m.color === YELLOW), JSON.stringify(marks));
check('点直径 = 2 × 4px 线宽', marks.length === 2 && marks.every((m) => m.w === 8 && m.h === 8));
await p.getByRole('button', { name: '定位到我的位置' }).click();
await p.waitForTimeout(1000);
marks = await markerInfo();
check('当前位置是蓝点', marks.filter((m) => m.color === BLUE).length === 1);
await tab('记录').click();
await p.waitForTimeout(300);
await p.locator('.loc-list .music-row').first().click();
await p.waitForTimeout(900);
marks = await markerInfo();
check('选中的点是红点', marks.filter((m) => m.color === RED).length === 1);
check('其余历史点仍是黄色', marks.filter((m) => m.color === YELLOW).length === 1);
check('蓝点仍在', marks.filter((m) => m.color === BLUE).length === 1);

console.log('\nD5 修改偏移并写回');
await tab('文件').click();
await p.waitForTimeout(400);
const offInputs = p.locator('.loc-offset input');
await offInputs.nth(0).fill(String(offset2.lat));
await offInputs.nth(1).fill(String(offset2.lng));
await p.getByRole('button', { name: '保存偏移' }).click();
await p.waitForTimeout(1400);
await tab('记录').click();
await p.waitForTimeout(400);
const shiftedText = await p.locator('.loc-list').innerText();
check(
  '改偏移后坐标整体平移',
  shiftedText.includes('31.232400,121.476700') && shiftedText.includes('31.233000,121.477500'),
  shiftedText.replace(/\n/g, ' | ').slice(0, 160),
);
const afterEdit = (await locationBlobs()).map((t) => JSON.parse(t)).find((d) => d.name === '偏移轨迹');
check(
  '偏移写进文件',
  !!afterEdit && afterEdit.offset.lat === offset2.lat && afterEdit.offset.lng === offset2.lng,
);
check(
  '原始点没有被改写',
  !!afterEdit && afterEdit.points[0].lat === raw1.lat && afterEdit.points[0].lng === raw1.lng,
);

await p.reload({ waitUntil: 'load' });
await waitBoot();
await p.waitForTimeout(800);
await toLocation();
await p.waitForTimeout(800);
check('刷新后自动恢复上次文件', (await p.locator('.loc-card-head', { hasText: '偏移轨迹' }).count()) >= 1);
await tab('文件').click();
await p.waitForTimeout(400);
const restored = p.locator('.loc-offset input');
check(
  '刷新后偏移回填',
  (await restored.nth(0).inputValue()) === String(offset2.lat) &&
    (await restored.nth(1).inputValue()) === String(offset2.lng),
);

console.log('\nD6 文件库筛选 / 预览');
await toSettingsRoot();
await p.locator('.settings-nav-title', { hasText: /^文件$/ }).click();
await p.waitForTimeout(800);
await p.getByRole('button', { name: /筛选/ }).click();
await p.waitForTimeout(300);
await p.locator('.chip', { hasText: /^定位$/ }).click();
await p.waitForTimeout(500);
check('文件库能筛出 .drloc', (await p.getByText('偏移轨迹.drloc').count()) >= 1);
check('类型徽标显示「定位」', (await p.locator('.file-type', { hasText: /^定位$/ }).count()) >= 1);
await p.getByText('偏移轨迹.drloc').first().click();
await p.waitForTimeout(1000);
check('预览标题是定位', (await p.locator('.modal-head h3').textContent())?.includes('定位'));
check('预览列出 2 个点', (await p.locator('.playlist-preview-list li').count()) === 2);
check(
  '预览坐标也带偏移',
  (await p.locator('.playlist-preview-list').innerText()).includes('31.232400, 121.476700'),
);
await p.locator('.modal-head .icon-btn').click();
await p.waitForTimeout(400);

console.log('\nD7 旧 CSV 导入转换');
await toLocation();
await p.waitForTimeout(600);
await tab('文件').click();
await p.waitForTimeout(300);
await p.getByRole('button', { name: '导入 .drloc / 旧 CSV' }).click();
await p.locator('input[accept*="drloc"]').setInputFiles(csvFile);
await p.waitForTimeout(1600);
check('CSV 导入后变成 .drloc', (await p.locator('.loc-card-head', { hasText: 'legacy' }).count()) >= 1);
check('CSV 的点被读进来', (await p.locator('.loc-list .music-row').count()) === 1);
check('CSV 点坐标正确', (await p.locator('.loc-list').innerText()).includes('30.100100,120.200200'));
const legacyBlob = (await locationBlobs()).map((t) => JSON.parse(t)).find((d) => d.name === 'legacy');
check('转换后的文件格式是 dr.location', !!legacyBlob && legacyBlob.format === 'dr.location');

await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });

console.log('\n========== 汇总 ==========');
if (failures.length) {
  console.log(`${failures.length} 项失败：`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('全部通过 ✓');
