// 软件适配测试页的界面回归。
//
// K1 功能体验里有「软件适配测试」入口，点进去是独立子页（10 张测试卡 + 顶部汇总）
// K2 引擎信息自动填好：UA 非空、Gecko 判定为「否」（Chromium 下）
// K3 应用依赖自检：WebAssembly / IndexedDB / Blob 下载三条必须 ✓（本项目跑不跑的底线）
// K4 原生桥：普通浏览器里没有注入，ping 应在 3s 后超时并判 ✗，汇总同步
// K5 功能面板不再有「高精度定位」（用户要求下线），只剩音乐 / 定位
// K6 离开子页再回来，汇总里刚才的结果还在（模块级状态）
//
// 依赖：`npm run build` 后用静态服务器起 dist，再装 playwright。
// 用法：node tools/e2e/compat-test-e2e.mjs [url]

import fs from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const APP = process.argv[2] || 'http://localhost:4173/';

const failures = [];
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
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

const backToSettingsRoot = async () => {
  for (let i = 0; i < 4; i += 1) {
    if (await p.locator('.settings-nav-title').first().isVisible().catch(() => false)) return;
    const back = p.locator('.back-btn').first();
    if (!(await back.count())) return;
    await back.click();
    await p.waitForTimeout(300);
  }
};

console.log('\n=== 软件适配测试 ===');

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(2000);
}
await p.locator('.tabbar-item', { hasText: '设置' }).click();
await p.waitForTimeout(400);
await backToSettingsRoot();

console.log('\nK1 入口与页面');
await p.locator('.settings-nav-title', { hasText: '功能体验' }).click();
await p.waitForTimeout(400);
const compatEntry = p.locator('.settings-hub-item', { has: p.locator('.settings-hub-title', { hasText: '软件适配测试' }) });
check('功能体验里有「软件适配测试」', (await compatEntry.count()) === 1);
const entryIcon = compatEntry.locator('.settings-hub-icon svg');
const iconBox = await entryIcon.boundingBox();
check('入口图标正常渲染', !!iconBox && iconBox.width > 6 && iconBox.height > 6);

await compatEntry.click();
await p.waitForTimeout(600);
const title = (await p.locator('.lab-page-title').first().innerText()).trim();
check('子页标题是「软件适配测试」', title === '软件适配测试', title);
const cards = await p.locator('.compat-card').count();
check('10 张测试卡都在', cards === 10, `${cards} 张`);
const cardTitles = await p.locator('.compat-card .card-title').allInnerTexts();
for (const t of ['引擎信息', '原生桥状态', '应用依赖（本软件自检）', '麦克风测试（getUserMedia）', '定位测试（geolocation）', '录屏（MediaProjection）']) {
  check(`有「${t}」卡`, cardTitles.includes(t));
}
check('顶部有汇总', (await p.locator('.compat-summary').count()) === 1);

console.log('\nK2 引擎信息');
const ua = (await p.locator('.compat-ua').innerText()).trim();
check('UA 非空', ua.length > 20, ua.slice(0, 60));
const engineRows = await p.locator('.compat-kv dd').allInnerTexts();
check('SecureContext 有结论', /^(是|否)$/.test(engineRows[1] ?? ''), JSON.stringify(engineRows));
check('Chromium 下判为非 Gecko', /否/.test(engineRows[2] ?? ''), String(engineRows[2]));

console.log('\nK3 应用依赖');
await p.waitForTimeout(400);
const depRows = await p.locator('.compat-deps li').evaluateAll((els) =>
  els.map((el) => ({
    name: el.querySelector('.compat-deps-name')?.textContent?.trim() ?? '',
    ok: el.classList.contains('compat-deps-ok'),
  })),
);
check('依赖清单渲染出 7 条', depRows.length === 7, JSON.stringify(depRows.map((d) => d.name)));
for (const name of ['WebAssembly', 'IndexedDB', 'Blob 下载']) {
  const row = depRows.find((d) => d.name.startsWith(name));
  check(`${name} ✓`, !!row?.ok, JSON.stringify(row));
}

console.log('\nK4 原生桥（浏览器里应判未注入）');
// 600ms 后自动 ping，3s 超时 → 等足 5s 再看
await p.waitForTimeout(5000);
const bridgeStatus = (await p.locator('.compat-card', { hasText: '原生桥状态' }).locator('.compat-status').innerText()).trim();
check('桥状态写着未连接', /桥未连接|超时/.test(bridgeStatus), bridgeStatus.slice(0, 120));
check('注入了当「未注入」', /注入：✗/.test(bridgeStatus), bridgeStatus.slice(0, 60));
const bridgeChip = await p.locator('.compat-chip', { hasText: '原生桥' }).innerText();
check('汇总里原生桥标 ✗', /✗/.test(bridgeChip), bridgeChip);
const summaryLine = (await p.locator('.compat-summary-line strong').innerText()).trim();
check('汇总统计可读', /^\d+ \/ 10 通过$/.test(summaryLine), summaryLine);

console.log('\nK6 离开再回来，结果还在');
await p.locator('.back-btn').first().click();
await p.waitForTimeout(400);
await p.locator('.settings-hub-item', { has: p.locator('.settings-hub-title', { hasText: '软件适配测试' }) }).click();
await p.waitForTimeout(800);
const chipAgain = await p.locator('.compat-chip', { hasText: '原生桥' }).innerText();
check('重新进入后汇总仍记得上次结果', /✗/.test(chipAgain), chipAgain);

console.log('\nK5 功能面板不含高精度定位');
await p.locator('.back-btn').first().click();
await p.waitForTimeout(400);
await p.locator('.back-btn').first().click();
await p.waitForTimeout(400);
await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
await p.waitForTimeout(500);
const panelTitles = await p.locator('.settings-hub-title').allInnerTexts();
check('功能面板只剩音乐 / 定位', panelTitles.length === 2, JSON.stringify(panelTitles));
check('没有「高精度定位」', !panelTitles.some((t) => t.includes('高精度')));

// 截图留档：手机上这一页很长，截前两屏即可
await p.locator('.back-btn').first().click();
await p.waitForTimeout(300);
await p.locator('.settings-nav-title', { hasText: '功能体验' }).click();
await p.waitForTimeout(300);
await p.locator('.settings-hub-item', { has: p.locator('.settings-hub-title', { hasText: '软件适配测试' }) }).click();
await p.waitForTimeout(1200);
fs.mkdirSync('/tmp/compat-shots', { recursive: true });
await p.screenshot({ path: '/tmp/compat-shots/compat-top.png' });
await p.locator('.compat-card', { hasText: '麦克风测试' }).scrollIntoViewIfNeeded();
await p.waitForTimeout(300);
await p.screenshot({ path: '/tmp/compat-shots/compat-mid.png' });
await ctx.close();

/* ------------------------------------------------------------------ *
 * K7 用一个假壳把协议跑通：真机/真壳不在手边时，这是唯一能验证
 * 「请求发出去、响应回来、事件推上来」三段链路都对的办法。
 * mock 只装在页面脚本之前（addInitScript），不碰真实代码。
 * ------------------------------------------------------------------ */

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

  const replies = {
    ping: { pong: true, shell: 'mock' },
    'ble.status': { enabled: true, scanning: false },
    'ble.startScan': {},
    'ble.stopScan': {},
    'ble.connect': {},
    'ble.read': { value: 'aGVsbG8=' },
    'ble.write': {},
    'ble.subscribe': {},
    'ble.disconnect': {},
    'ble.peripheral.start': {},
    'ble.peripheral.stop': {},
    'ble.peripheral.setValue': {},
    'file.writePrivate': { path: '/data/files/log.txt', size: 11 },
    'file.appendPrivate': { path: '/data/files/log.txt', size: 22 },
    'file.readPrivate': { content: 'hello private' },
    'file.listPrivate': { files: ['log.txt'] },
    'file.deletePrivate': { deleted: true },
    'file.writePublic': { uri: 'content://downloads/report.txt' },
    'file.readPublic': { content: 'hello public' },
    'file.deletePublic': { deleted: true },
    'screen.start': {},
    'screen.stop': {},
    'screen.status': { recording: false }
  };

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.type !== 'gv-bridge-request') return;
    const post = (payload) => window.postMessage(payload, '*');
    if (!(m.action in replies)) {
      post({ type: 'gv-bridge-response', id: m.id, ok: false, error: 'mock 不认这个 action：' + m.action });
      return;
    }
    post({ type: 'gv-bridge-response', id: m.id, ok: true, result: replies[m.action] });
    if (m.action === 'ble.startScan') {
      setTimeout(() => post({
        type: 'gv-bridge-event', event: 'ble.deviceFound',
        data: { address: 'AA:BB:CC:DD:EE:FF', name: 'Mock 心率带', rssi: -42 }
      }), 60);
    }
    if (m.action === 'ble.connect') {
      setTimeout(() => {
        post({ type: 'gv-bridge-event', event: 'ble.connected', data: { address: 'AA:BB:CC:DD:EE:FF' } });
        post({
          type: 'gv-bridge-event', event: 'ble.services',
          data: { services: [{
            uuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
            characteristics: [{ uuid: '0000ffe1-0000-1000-8000-00805f9b34fb', properties: 'read,write' }]
          }] }
        });
      }, 60);
    }
  });
})();
`;

const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx2.addInitScript(MOCK);
const q = await ctx2.newPage();
q.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await q.goto(APP, { waitUntil: 'load' });
await q.waitForFunction(
  () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
  null,
  { timeout: 90000 },
);
// 全新库会先停在欢迎页。这里载入示例数据而不是「直接开始创建」：
// 后者会顺手弹出新建人物表单，把设置入口挡住
if (await q.getByText('载入示例数据看看效果').count()) {
  await q.getByText('载入示例数据看看效果').click();
  await q.waitForTimeout(2000);
}
await q.locator('.tabbar-item', { hasText: '设置' }).click();
await q.waitForTimeout(400);
await q.locator('.settings-nav-title', { hasText: '功能体验' }).click();
await q.waitForTimeout(300);
await q.locator('.settings-hub-item', { has: q.locator('.settings-hub-title', { hasText: '软件适配测试' }) }).click();
await q.waitForTimeout(1500);

console.log('\nK7 假壳跑通协议（注入标记 + 请求/响应/事件）');
const mockBridge = (await q.locator('.compat-card', { hasText: '原生桥状态' }).locator('.compat-status').innerText()).trim();
check('桥已连接并回传 ping 结果', /桥已连接 ✓/.test(mockBridge), mockBridge.slice(0, 120));
check('注入标记读到了', /注入：✓/.test(mockBridge), mockBridge.slice(0, 60));

const fileCard = q.locator('.compat-card', { hasText: '文件写入 · 私有目录' });
await fileCard.getByRole('button', { name: '写入' }).click();
await q.waitForTimeout(300);
const fileStatus = (await fileCard.locator('.compat-status').innerText()).trim();
check('私有文件写入成功并显示路径', /已写入私有目录：\/data\/files\/log\.txt（11B）/.test(fileStatus), fileStatus);

await fileCard.getByRole('button', { name: '读取' }).click();
await q.waitForTimeout(300);
check('私有文件读取回显内容', /读取：hello private/.test(await fileCard.locator('.compat-status').innerText()));

const bleCard = q.locator('.compat-card', { hasText: '蓝牙 · 中心设备' });
await bleCard.getByRole('button', { name: '开始扫描' }).click();
await q.waitForTimeout(500);
const devRow = bleCard.locator('.compat-dev');
check('扫描事件把设备推上了列表', (await devRow.count()) === 1, await devRow.innerText().catch(() => ''));
await devRow.getByRole('button', { name: '连接' }).click();
await q.waitForTimeout(500);
const gattSelect = bleCard.locator('.compat-gatt select');
check('连接后出现 GATT 特征值', (await gattSelect.count()) === 1);
const opts = await gattSelect.locator('option').allInnerTexts().catch(() => []);
check('特征值选项列出了服务/特征', opts.length === 1 && /读|write|read/.test(opts[0] ?? ''), JSON.stringify(opts));

const chips = await q.locator('.compat-chip').evaluateAll((els) =>
  els.map((el) => ({ label: el.firstChild?.textContent?.trim() ?? '', text: el.textContent ?? '' })),
);
const chipOf = (label) => chips.find((c) => c.label === label)?.text ?? '';
check('汇总里原生桥 ✓', /✓/.test(chipOf('原生桥')), chipOf('原生桥'));
check('汇总里文件私有 ✓', /✓/.test(chipOf('文件私有')), chipOf('文件私有'));
check('汇总里蓝牙中心 ✓', /✓/.test(chipOf('蓝牙中心')), chipOf('蓝牙中心'));
await q.screenshot({ path: '/tmp/compat-shots/compat-mock.png' });

console.log(`\n========== 汇总 ==========\n${failures.length ? `失败 ${failures.length} 项：${failures.join('、')}` : '全部通过 ✓'}`);
await browser.close();
if (failures.length) process.exit(1);
