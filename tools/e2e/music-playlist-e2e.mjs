// 歌单文件（.drpl）端到端回归。
//
// 验证：
//   P1 上传音频 → 新建歌单（默认把当前队列一起存入）→ 自动选中
//   P2 文件库里出现歌单类型：筛选「歌单」能看到、预览能列出曲目
//   P3 刷新后恢复上次选中的歌单与曲目
//   P4 改名 / 改描述：选择器、文件名与正文同步
//   P5 增删 / 排序自动写回文件，刷新后顺序保留
//   P6 从本地导入 .drpl，按 storedId/文件名重新对上本地曲目
//   P7 删除歌单文件后回到临时队列，曲目文件不被删除
//
// 依赖：`npm run build` 后用静态服务器起 dist（任选），再装 playwright。
// 用法：node tools/e2e/music-playlist-e2e.mjs [url]

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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-playlist-'));

const failures = [];
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures.push(label);
};

/** 生成一个 1 秒单音 wav */
function writeTone(file, freq) {
  const sr = 8000;
  const n = sr;
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sr, 24);
  data.writeUInt32LE(sr * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) {
    data.writeInt16LE(Math.round(11000 * Math.sin((2 * Math.PI * freq * i) / sr)), 44 + i * 2);
  }
  fs.writeFileSync(file, data);
}

const tone1 = path.join(TMP, 'tone.wav');
const tone2 = path.join(TMP, 'tone2.wav');
writeTone(tone1, 440);
writeTone(tone2, 880);

const importFile = path.join(TMP, 'import.drpl');
fs.writeFileSync(
  importFile,
  JSON.stringify(
    {
      format: 'dr.playlist',
      version: 1,
      name: '导入测试',
      description: 'e2e',
      tracks: [{ storedId: 'tone.wav', name: 'tone.wav' }],
    },
    null,
    2,
  ),
);

const browser = await chromium.launch({
  // 无头环境（CI / 沙箱）一般只有系统 chromium；本机装了 Playwright 自带浏览器时可留空
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
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

/** 手机端设置是两态：子页里导航隐藏，先按返回回到目录 */
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

const toMusic = async () => {
  await toSettingsRoot();
  await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: '音乐' }).first().click();
  await p.waitForTimeout(700);
};

const toFiles = async () => {
  await toSettingsRoot();
  await p.locator('.settings-nav-title', { hasText: /^文件$/ }).click();
  await p.waitForTimeout(700);
};

console.log('\n=== 歌单文件 .drpl 端到端 ===');

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(2500);
}

console.log('\nP1 上传 + 新建');
await toMusic();
await p.locator('input[accept="audio/*"]').setInputFiles(tone1);
await p.waitForTimeout(1600);
check('上传后曲目进入队列', (await p.locator('.music-row').count()) >= 1);

await p.getByRole('button', { name: '新建', exact: true }).click();
await p.waitForTimeout(300);
await p.locator('.modal input').first().fill('夜跑');
check('新建弹窗默认勾选带上当前队列', await p.locator('.music-check input').isChecked());
await p.getByRole('button', { name: '创建', exact: true }).click();
await p.waitForTimeout(1200);
check('创建后自动选中新歌单', !!(await p.locator('.music-pl-select').inputValue()));
check('选择器显示歌单名', (await p.locator('.music-pl-select option:checked').textContent()) === '夜跑');
check('曲目仍在歌单里', (await p.locator('.music-row').count()) === 1);

console.log('\nP2 文件库筛选 + 预览');
await toFiles();
await p.getByRole('button', { name: /筛选/ }).click();
await p.waitForTimeout(200);
await p.locator('.chip', { hasText: /^歌单$/ }).click();
await p.waitForTimeout(500);
check('文件库里能看到 .drpl 文件', (await p.getByText('夜跑.drpl').count()) >= 1);
check('类型徽标显示「歌单」', (await p.locator('.file-type', { hasText: /^歌单$/ }).count()) >= 1);
await p.getByText('夜跑.drpl').first().click();
await p.waitForTimeout(900);
check('歌单预览列出曲目', (await p.locator('.playlist-preview-list li').count()) >= 1);
check('预览标题是歌单', (await p.locator('.modal-head h3').textContent())?.includes('歌单'));
await p.locator('.modal-head .icon-btn').click();
await p.waitForTimeout(300);

console.log('\nP3 刷新恢复');
await p.reload({ waitUntil: 'load' });
await waitBoot();
await toMusic();
await p.waitForTimeout(900);
check('刷新后仍选中「夜跑」', (await p.locator('.music-pl-select option:checked').textContent()) === '夜跑');
check('刷新后曲目还在', (await p.locator('.music-row').count()) === 1);

console.log('\nP4 改名 / 描述');
await p.getByRole('button', { name: '改名 / 描述' }).click();
await p.waitForTimeout(300);
await p.locator('.modal input').first().fill('夜跑 2');
await p.locator('.modal textarea').fill('晚上听');
await p.getByRole('button', { name: '保存', exact: true }).click();
await p.waitForTimeout(1200);
check('歌单名已更新', (await p.locator('.music-pl-select option:checked').textContent()) === '夜跑 2');
check('描述已显示', (await p.locator('.music-pl-meta').textContent())?.includes('晚上听'));

console.log('\nP5 增删 / 排序写回');
await p.locator('input[accept="audio/*"]').setInputFiles(tone2);
await p.waitForTimeout(1600);
check('第二首加入', (await p.locator('.music-row').count()) === 2);
const firstBefore = await p.locator('.music-row-name').first().textContent();
await p.locator('.music-row').first().locator('.music-move').nth(1).click();
await p.waitForTimeout(1000);
const firstAfter = await p.locator('.music-row-name').first().textContent();
check('下移后顺序变化', firstBefore !== firstAfter, `${firstBefore} → ${firstAfter}`);
await p.reload({ waitUntil: 'load' });
await waitBoot();
await toMusic();
await p.waitForTimeout(900);
check('刷新后顺序保留', (await p.locator('.music-row-name').first().textContent()) === firstAfter);
check('刷新后歌单名保留', (await p.locator('.music-pl-select option:checked').textContent()) === '夜跑 2');

console.log('\nP6 导入 .drpl');
await p.getByRole('button', { name: '导入', exact: true }).click();
await p.locator('input[accept*="drpl"]').setInputFiles(importFile);
await p.waitForTimeout(1600);
check('导入后自动选中', (await p.locator('.music-pl-select option:checked').textContent()) === '导入测试');
check('按文件名兜底匹配到本地曲目', (await p.locator('.music-row').count()) === 1);
check('没有缺失提示', (await p.locator('.music-missing').count()) === 0);

console.log('\nP7 删除当前歌单');
await p.locator('.music-pl-meta').getByRole('button', { name: '删除' }).click();
await p.waitForTimeout(200);
await p.getByRole('button', { name: '确认', exact: true }).click();
await p.waitForTimeout(1200);
check('删除后回到临时队列', (await p.locator('.music-pl-select option:checked').textContent()).includes('临时队列'));
check('曲目作为临时队列保留', (await p.locator('.music-row').count()) === 1);

await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });

console.log('\n========== 汇总 ==========');
if (failures.length) {
  console.log(`${failures.length} 项失败：`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('全部通过 ✓');
