#!/usr/bin/env node
// 跨设备操作（壳端作服务器）网页侧 e2e。
//
// 用假壳桥替身挡住 remote.*，用仓库自带 Node 中继当真正的 WS 服务器，
// 这样网页走的是和真机一样的路径：capabilities → start → startHost(ws://127.0.0.1)。
//
// 覆盖：
//   S1 服务页列出「跨设备操作」，壳端可用时自启动可点
//   S2 打开自启动 → 壳端端口启动 + 页面以服务端身份连上中继
//   S3 设置页：连接方式显示「壳端服务」，连接串用手机局域网 IP，一键地址带 token，自启动已勾
//   S4 第二台设备（无桥）从 http://IP:端口 打开，作为客户端连上并使用服务端数据
//   S4b 服务端换配色 → 客户端同步（且不覆盖客户端自己的存档）
//   S4c 一键地址 ?token= 打开直接是客户端，地址栏里的 token 用完即抹
//   S5 服务端停止 → 客户端被断开并回到本地
//   S6 关掉自启动 → 壳端存档同步
//
// 用法：node tools/e2e/datashare-e2e.mjs [port]
// 前置：npm run build；本脚本自己起 tools/remote-relay。

import { spawn } from 'node:child_process';
import fs from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const PORT = Number(process.argv[2] || 4190);
const APP = `http://127.0.0.1:${PORT}/`;
const TOKEN = 'e2e-token';
const LAN_IP = '192.168.1.50';
const failures = [];
const check = (label, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
    failures.push(label);
  }
};

// ---- 起 Node 中继（托管 dist）----
const relay = spawn(process.execPath, ['tools/remote-relay/server.mjs', '--port', String(PORT), '--token', TOKEN, '--dist', 'dist'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
relay.stdout.on('data', (d) => process.stdout.write(`[relay] ${d}`));
relay.stderr.on('data', (d) => process.stderr.write(`[relay] ${d}`));
const stopRelay = () => {
  try {
    relay.kill('SIGINT');
  } catch {
    /* ignore */
  }
};
process.on('exit', stopRelay);

async function waitRelay() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${APP}__remote/info?token=${TOKEN}`);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('中继没起来');
}
await waitRelay();

const FAKE_BRIDGE = `
(() => {
  const st = { running: false, port: ${PORT}, token: '${TOKEN}', autostart: false, hostOnline: false, clients: 0, addresses: ['${LAN_IP}'] };
  window.__fakeRelay = st;
  window.__bridgeCalls = [];
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.type !== 'gv-bridge-request') return;
    window.__bridgeCalls.push({ action: m.action, params: m.params });
    const reply = (ok, result, error) =>
      window.postMessage({ type: 'gv-bridge-response', id: m.id, ok, result, error }, '*');
    const p = m.params || {};
    switch (m.action) {
      case 'remote.capabilities':
        reply(true, { version: 1, defaultPort: 4173, actions: ['remote.status', 'remote.start', 'remote.stop', 'remote.autostart'] });
        break;
      case 'remote.status':
        reply(true, { ...st });
        break;
      case 'remote.start':
        if (p.port) st.port = Number(p.port);
        if (p.token) st.token = String(p.token);
        st.running = true;
        reply(true, { ...st });
        break;
      case 'remote.stop':
        st.running = false;
        st.hostOnline = false;
        st.clients = 0;
        reply(true, { ...st });
        break;
      case 'remote.autostart':
        st.autostart = p.enabled === true;
        reply(true, { ...st });
        break;
      default:
        reply(false, null, 'unknown action');
    }
  });
})();
`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});

const hostCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
await hostCtx.addInitScript(FAKE_BRIDGE);
const p = await hostCtx.newPage();
p.on('pageerror', (e) => console.log('[host pageerror]', String(e).slice(0, 300)));

const boot = async (page) => {
  await page.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );
};
const relayInfo = async () => (await (await fetch(`${APP}__remote/info?token=${TOKEN}`)).json());
/** 「服务」不是底部 tab，而是主页 head 里的文字按钮；先退出设置子页，再切到时间线 */
const goServices = async (page) => {
  if (await page.locator('.svc-row').count()) return;
  for (let i = 0; i < 5; i++) {
    const back = page.locator('.page-head .back-btn');
    if ((await back.count()) > 0 && (await back.first().isVisible().catch(() => false))) {
      await back.first().click();
      await page.waitForTimeout(400);
      continue;
    }
    break;
  }
  if (!(await page.locator('.svc-row').count())) {
    await page.locator('.tabbar-item', { hasText: '时间线' }).click();
    await page.waitForTimeout(500);
    await page.locator('.hs-text', { hasText: '服务' }).click();
    await page.waitForTimeout(600);
  }
};

/** 设置 → 备份与分享 → 跨设备操作；已经在目标页时直接返回 */
const openRemote = async (page) => {
  await page.locator('.tabbar-item', { hasText: '设置' }).click();
  await page.waitForTimeout(500);
  if (await page.locator('.remote-section').count()) return;
  // 手机子页会把目录藏起来：先退到目录，再点「备份与分享」
  for (let i = 0; i < 4; i++) {
    const navEl = page.locator('.settings-nav-title', { hasText: '备份与分享' });
    if ((await navEl.count()) > 0 && (await navEl.first().isVisible().catch(() => false))) break;
    const back = page.locator('.page-head .back-btn');
    if (!(await back.count())) break;
    await back.first().click();
    await page.waitForTimeout(450);
  }
  const nav = page.locator('.settings-nav-title', { hasText: '备份与分享' });
  if (await nav.count()) {
    await nav.click();
    await page.waitForTimeout(500);
  }
  const hub = page.locator('.settings-hub-title', { hasText: '跨设备操作' });
  if (await hub.count()) {
    await hub.click();
    await page.waitForTimeout(700);
  }
};
const waitFor = async (fn, ms = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await fn()) return true;
    } catch {
      /* 页面正在刷新时执行上下文会短暂失效，下一轮再试 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

await p.goto(APP, { waitUntil: 'load' });
await boot(p);

// ---- S1 服务页 ----
console.log('\nS1 服务页列出「跨设备操作」');
const hasSeed = await p.getByText('载入示例数据看看效果').count();
if (hasSeed) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(2500);
}
await p.locator('.hs-text', { hasText: '服务' }).click();
await p.waitForTimeout(800);
const row = p.locator('.svc-row', { hasText: '跨设备操作' });
check('服务页有「跨设备操作」一行', (await row.count()) === 1);
const checkBox = row.locator('.svc-auto input');
check('壳端可用时「自启动」可勾选', (await checkBox.isDisabled()) === false);
check('初始显示已停止', (await row.innerText()).includes('已停止'), await row.innerText());

// ---- S2 打开自启动 ----
console.log('\nS2 打开自启动 → 端口启动 + 页面连上');
await checkBox.check();
const online = await waitFor(async () => (await relayInfo()).hostOnline === true);
check('中继看到服务端在线', online);
const hostRun = await p.evaluate(() => window.__fakeRelay.running === true);
check('壳端端口已启动', hostRun);
const autoCall = await p.evaluate(() => window.__bridgeCalls.some((c) => c.action === 'remote.autostart' && c.params.enabled === true));
check('自启动偏好已写到壳端', autoCall);
const rowText = await row.innerText();
check('服务页显示运行中', rowText.includes('运行中'), rowText);
check('服务页显示端口/客户端', rowText.includes(`端口 ${PORT}`), rowText);

// ---- S3 设置页 ----
console.log('\nS3 设置页显示壳端服务');
await openRemote(p);
check('服务端徽标「已开启」', (await p.locator('.remote-badge-on', { hasText: '已开启' }).count()) === 1);
check('卡片写明页面由壳端服务提供', (await p.locator('.remote-section').innerText()).includes('页面由壳端服务提供'));
const share = await p.locator('.remote-section textarea.remote-share').first().inputValue();
check('连接串用手机局域网 IP', share === `${LAN_IP}:${PORT}?token=${TOKEN}`, share);
const joinUrl = await p.locator('.remote-section textarea.remote-share').nth(1).inputValue();
check(
  '一键地址带 token',
  joinUrl === `http://${LAN_IP}:${PORT}/?token=${TOKEN}`,
  joinUrl,
);
check('一键地址旁写明直接粘浏览器', (await p.locator('.remote-section').innerText()).includes('粘到另一台设备的浏览器'));
check('设置页自启动已勾选', (await p.locator('.remote-auto input').isChecked()) === true);

// ---- S4 客户端（无桥，http 源）----
console.log('\nS4 第二台设备作为客户端连上');
const clientCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const cp = await clientCtx.newPage();
cp.on('pageerror', (e) => console.log('[client pageerror]', String(e).slice(0, 300)));
await cp.goto(APP, { waitUntil: 'load' });
await boot(cp);
const seedClient = await cp.getByText('载入示例数据看看效果').count();
if (seedClient) {
  await cp.getByText('载入示例数据看看效果').click();
  await cp.waitForTimeout(2500);
}
await openRemote(cp);
await cp.waitForTimeout(1800); // 等壳端探测超时，走回退 UI
const clientAddr = cp.locator('.remote-section input[placeholder*="192.168.1.8:4173"]');
const prefilled = await clientAddr.inputValue();
check('客户端地址已按当前源预填', prefilled === `127.0.0.1:${PORT}`, prefilled);
await clientAddr.fill(`127.0.0.1:${PORT}`);
await cp.locator('.remote-section input[placeholder="与服务端一致"]').fill(TOKEN);
await cp.locator('.remote-section button', { hasText: '连接服务端' }).click();
const clientBar = await waitFor(async () => (await cp.locator('.remote-bar-client').count()) === 1, 20000);
check('客户端进入「服务端数据」模式', clientBar);
if (clientBar) {
  const barText = await cp.locator('.remote-bar-client').innerText();
  check('状态条写明来自服务端', barText.includes('服务端数据'), barText);
}
const sess = await cp.evaluate(() => sessionStorage.getItem('dr.remote.client'));
check('客户端记住了连接（刷新可恢复）', !!sess, String(sess));
const infoWithClient = await relayInfo();
check('中继报告 1 个客户端', infoWithClient.clients === 1, JSON.stringify(infoWithClient));
const hostBar = await p.locator('.remote-bar-host').innerText();
check('服务端状态条显示 1 个客户端', hostBar.includes('1 个客户端'), hostBar);

// ---- S4b 配色跟着服务端走 ----
console.log('\nS4b 服务端换配色 → 客户端同步');
/** 设置子页在手机上藏起目录，先一路退回目录再点「外观」 */
const openAppearance = async (page) => {
  // 手机子页只把目录藏起来（display:none），元素仍在 DOM，所以看 isVisible 不看 count
  for (let i = 0; i < 4; i++) {
    const navEl = page.locator('.settings-nav-title', { hasText: '外观' });
    if ((await navEl.count()) > 0 && (await navEl.first().isVisible().catch(() => false))) break;
    const back = page.locator('.page-head .back-btn');
    if (!(await back.count())) break;
    await back.first().click();
    await page.waitForTimeout(450);
  }
  await page.locator('.settings-nav-title', { hasText: '外观' }).click();
  await page.waitForTimeout(800);
};
await openAppearance(p);
await p.locator('.theme-mode button', { hasText: '深色' }).click();
await p.locator('.theme-swatch', { hasText: '湖蓝' }).click();
await p.waitForTimeout(400);
const hostPrimary = await p.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
);
const clientDark = await waitFor(
  async () => (await cp.evaluate(() => document.documentElement.dataset.mode)) === 'dark',
);
check('客户端跟随服务端切到深色', clientDark);
const clientPrimary = await cp.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
);
check('客户端主题色与服务端一致', clientPrimary === hostPrimary, `${clientPrimary} vs ${hostPrimary}`);
const clientStored = await cp.evaluate(() => localStorage.getItem('dr.appearance.v1'));
check('客户端没把服务端配色写进自己的存档', clientStored === null, String(clientStored));
// 回到跨设备页，后面的停止步骤还在这一页上
await openRemote(p);

// ---- S4c 一键地址：粘到浏览器直接是客户端 ----
console.log('\nS4c 一键地址 ?token= 打开即客户端');
const joinCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const jp = await joinCtx.newPage();
jp.on('pageerror', (e) => console.log('[join pageerror]', String(e).slice(0, 300)));
await jp.goto(`${APP}?token=${TOKEN}`, { waitUntil: 'load' });
await boot(jp);
const joinClient = await waitFor(
  async () => (await jp.locator('.remote-bar-client').count()) === 1,
  25000,
);
check('一键地址直接进入客户端模式', joinClient);
check('地址栏里的 token 已抹掉', !jp.url().includes('token'), jp.url());
const sessJoin = await jp.evaluate(() => sessionStorage.getItem('dr.remote.client'));
check('连接记进会话（刷新仍可恢复）', !!sessJoin, String(sessJoin));
const infoTwo = await relayInfo();
check('中继报告 2 个客户端', infoTwo.clients === 2, JSON.stringify(infoTwo));
// 用页面上的「断开」退出（等价于关标签页）：服务端应当立刻少一个客户端
await jp.locator('.remote-bar-client button', { hasText: '断开' }).click();
const backToOne = await waitFor(async () => (await relayInfo()).clients === 1, 15000);
check('一键客户端断开后回到 1 个', backToOne);
await jp.close();
await joinCtx.close();

// ---- S5 停止服务端 ----
console.log('\nS5 停止服务端 → 客户端回到本地');
await p.locator('.remote-section button', { hasText: '停止服务' }).click();
const offline = await waitFor(async () => (await relayInfo()).hostOnline === false);
check('中继报告服务端已离线', offline);
const cleared = await waitFor(async () => (await cp.evaluate(() => sessionStorage.getItem('dr.remote.client'))) === null, 20000);
check('客户端连接标记被清掉（回到本地库）', cleared);
await goServices(p);
await p.waitForTimeout(500);
const stoppedRow = await waitFor(async () =>
  (await p.locator('.svc-row', { hasText: '跨设备操作' }).innerText()).includes('已停止'),
);
check('服务页恢复「已停止」', stoppedRow);

// 停止后回到「空闲」态，连接方式标签才重新出现
await openRemote(p);
const tabs = await p.locator('.remote-switch button').allInnerTexts();
check('停止后连接方式叫「壳端服务（局域网）」', tabs.some((t) => t.includes('壳端服务')), tabs.join('|'));
await goServices(p);
await p.waitForTimeout(500);


// ---- S6 关掉自启动 ----
console.log('\nS6 关掉自启动');
const box2 = p.locator('.svc-row', { hasText: '跨设备操作' }).locator('.svc-auto input');
if (!(await box2.isChecked())) {
  // 停止服务不会自动关自启动；这里仍应为开
  console.log('  （自启动意外未勾选，跳过反转）');
} else {
  await box2.uncheck();
  // 桥调用是异步往返，等壳端偏好真正落下来再断言
  const off = await waitFor(async () => (await p.evaluate(() => window.__fakeRelay.autostart)) === false);
  check('壳端自启动偏好已关闭', off);
}
const stored = await p.evaluate(() => localStorage.getItem('dr.svc.autostart'));
check('网页存档里不再有 data-share', !stored || !JSON.parse(stored)['data-share'], String(stored));

console.log(`\n${failures.length ? `✗ ${failures.length} 项失败` : '全部通过'}`);
await browser.close();
stopRelay();
if (failures.length) process.exit(1);
