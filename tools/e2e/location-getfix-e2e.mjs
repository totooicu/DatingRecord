// 壳里手动定位（我的位置 / 打点）应优先走原生一次性定位桥 location.getFix，
// 不再依赖 WebView 拦截的 navigator.geolocation（那条在壳里不稳，表现为
// 「壳弹了『正在获取定位』却回不来坐标」）。本套验证网页这条路径确实走 getFix，
// 且完全不碰 navigator.geolocation。
//
// 依赖：vite preview（http://localhost:4173/）+ 桥 mock（注入 data-gv-bridge-injected）。
// 用法：node tools/e2e/location-getfix-e2e.mjs [url]

import fs from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const APP = process.argv[2] || 'http://localhost:4173/';
const sleep = (p, ms) => p.waitForTimeout(ms);

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
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

  // 故意让 WebView 的 geolocation 失效：永远不回调，证明手动定位不走这条路
  window.__geoCalls = 0;
  try {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: () => { window.__geoCalls += 1; },
        watchPosition: () => { window.__geoCalls += 1; return 1; },
        clearWatch: () => {}
      }
    });
  } catch (e) {}

  window.__calls = [];
  window.__getFixCalls = 0;
  // 壳返回一组 WGS-84 原始坐标（网页会换算成 GCJ-02）
  const FIX = { lat: 31.2304, lng: 121.4737, accuracy: 7 };
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.type !== 'gv-bridge-request') return;
    window.__calls.push({ action: m.action, params: m.params });
    const reply = (id, ok, result, error) =>
      window.postMessage({ type: 'gv-bridge-response', id, ok, result, error }, '*');
    switch (m.action) {
      case 'ping':
        return reply(m.id, true, { pong: true });
      case 'location.getFix':
        window.__getFixCalls += 1;
        return reply(m.id, true, FIX);
      case 'location.setConfig':
        return reply(m.id, true, Object.assign({}, m.params, { tracking: m.params.enabled === true }));
      case 'location.status':
        return reply(m.id, true, { tracking: false, points: 0 });
      case 'location.getHistory':
        return reply(m.id, true, { points: [] });
      default:
        return reply(m.id, false, null, 'mock 不认这个 action：' + m.action);
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
const pageErrors = [];
p.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
p.on('dialog', (d) => d.accept());

const toTab = async (tab) => {
  await p.getByRole('tab', { name: tab }).first().click();
  await sleep(p, 400);
};
const gotoLocation = async () => {
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await sleep(p, 500);
  const hub = p.locator('.settings-hub-title', { hasText: '定位' });
  if (await hub.count()) await hub.first().click();
  else {
    await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
    await sleep(p, 400);
    await p.locator('.settings-hub-title', { hasText: '定位' }).first().click();
  }
  await sleep(p, 1500);
};

const geoCalls = () => p.evaluate(() => window.__geoCalls ?? -1);
const getFixCalls = () => p.evaluate(() => window.__getFixCalls ?? 0);

await p.goto(APP, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none', null, { timeout: 90000 });

// 首次进入可能在欢迎页：载入示例数据跳过
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await sleep(p, 3000);
}

await gotoLocation();
// 新建一个定位文件
await toTab('文件');
const newBtn = p.getByRole('button', { name: '新建', exact: true });
if (await newBtn.count()) { await newBtn.first().click(); await sleep(p, 1200); }
await toTab('记录');

console.log('\n壳里点「我的位置」→ 应走 location.getFix，不碰 navigator.geolocation');
await p.getByRole('button', { name: '我的位置' }).click();
await sleep(p, 1500);
check('调用了原生一次性定位 location.getFix', (await getFixCalls()) >= 1, `getFixCalls=${await getFixCalls()}`);
check('完全没走 WebView 的 navigator.geolocation', (await geoCalls()) === 0, `geoCalls=${await geoCalls()}`);

console.log('\n壳里手动「记录位置」→ 同样走 location.getFix');
const before = await p.locator('.music-row').count();
await p.getByRole('button', { name: '记录位置' }).click();
await sleep(p, 1500);
const after = await p.locator('.music-row').count();
check('记录位置新增一行（getFix 拿到坐标）', after === before + 1, `before=${before} after=${after}`);
check('记录位置仍没走 navigator.geolocation', (await geoCalls()) === 0, `geoCalls=${await geoCalls()}`);

check('全程无页面错误', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\n========== 汇总 ==========\n${pass} 通过 / ${fail} 失败`);
await browser.close();
process.exit(fail ? 1 : 0);
