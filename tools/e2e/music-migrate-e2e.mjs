// 迁移回归：旧版把音乐自启动开关存在 localStorage['music-autostart']，
// 现在收归 store 的统一存档 dr.svc.autostart。老用户升级后首次打开应：
//   M1 自启动被兑现：head 出现音乐服务图标（有歌时）
//   M2 新存档里记上 music
//   M3 旧 key 被清掉（只搬一次，不会反复搬迁）
//
// 依赖：vite preview + 全局 playwright（路径按机器不同：nvm / 系统 node，两处都试一次）。
// 用法：node tools/e2e/music-migrate-e2e.mjs [url]

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

// 系统里没装 playwright 自带的浏览器，统一用 /usr/bin/chromium（CHROMIUM 可覆盖）。
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
p.on('dialog', (d) => d.accept());

const waitBoot = async () => {
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );
};

console.log('\n=== 迁移：旧版 music-autostart → dr.svc.autostart ===');

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(3000);
}

// 先传一首歌：自启动恢复时没歌可放，服务会保持已停止
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(400);
await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
await p.waitForTimeout(400);
await p.locator('.settings-hub-title', { hasText: '音乐' }).first().click();
await p.waitForTimeout(900);
// 音乐页现在有两个 file input：音频上传（audio/*）和歌单导入（.drpl），
// 只点第一个会撞 strict mode。按 accept 精确选音频那一个。
await p.locator('input[accept="audio/*"]').setInputFiles('/tmp/tone.wav');
await p.waitForTimeout(1500);
await p.locator('.tabbar-item', { hasText: '人物' }).click();
await p.waitForTimeout(500);

// 模拟旧版留下的开关，然后刷新 = 升级后首次打开
await p.evaluate(() => localStorage.setItem('music-autostart', '1'));
await p.reload({ waitUntil: 'load' });
await waitBoot();
await p.waitForTimeout(1800);

const icon = await p.locator('.home-head .hs-svc').count();
const title = icon ? await p.locator('.home-head .hs-svc').first().getAttribute('title') : '(无)';
check('M1：老用户的自启动被兑现，head 出现音乐服务图标', icon >= 1, `count=${icon} title=${title}`);
const newKey = await p.evaluate(() => localStorage.getItem('dr.svc.autostart'));
check('M2：自启动已搬进统一存档 dr.svc.autostart', !!newKey && newKey.includes('music'), `value=${newKey}`);
const legacy = await p.evaluate(() => localStorage.getItem('music-autostart'));
check('M3：旧 key 已清除（只搬一次）', legacy === null, `value=${legacy}`);

await browser.close();

console.log('\n========== 汇总 ==========');
if (failures.length) {
  console.log(`${failures.length} 项失败：`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('全部通过 ✓');
process.exit(0);
