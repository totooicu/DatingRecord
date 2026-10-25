// 连续打点「刷新恢复 + 原生看门狗」回归。
//
// 复现并锁死两类 bug：
//   A 刷新后不恢复（原 adoptNative 死角）：手动开始连续打点、不开自启动开关，
//     刷新后页面应凭 dr.autoLocation.enabled 自动接管（cfg.enabled 路径），
//     而不是「刷新后连续打点没反应」。
//   B 壳中途停了卡死（native:true 压着页面定时器）：壳停止记录后，原生看门狗在
//     宽限期内确认壳没在记，就退回页面定时器——否则切到哪种策略都「没反应」。
//
// 关键：假桥的 geolocation 会真返回一个坐标，所以退回页面定时器后仍能验证在打点。
// 每次发点都用明显不同的坐标，避免被 5m 阈值去重吃掉、掩盖「新增」判断。
//
// 用法：node tools/e2e/location-auto-resume-watchdog-e2e.mjs [url]

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
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
    failures.push(label);
  }
};

let emitSeq = 0;
const nextCoord = () => {
  emitSeq += 1;
  // 每次都明显不同（纬度每次 +0.01 ≈ 1.1km），不会被 5m 阈值去重
  return { lat: 31.2 + emitSeq * 0.01, lng: 121.4 + emitSeq * 0.01 };
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

  // 页面自己的 GPS：桩掉但【真返回一个坐标】，这样退回页面定时器后能验证还在打点
  window.__geoCalls = 0;
  try {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (cb) => {
          window.__geoCalls += 1;
          cb({ coords: { latitude: 31.23, longitude: 121.47, accuracy: 5 } });
        },
        watchPosition: () => { window.__geoCalls += 1; return 1; },
        clearWatch: () => {}
      }
    });
  } catch (e) {}

  const NATIVE = (window.__nativeState = { tracking: false, points: [] });
  try {
    const saved = sessionStorage.getItem('__mockNative');
    if (saved) Object.assign(NATIVE, JSON.parse(saved));
  } catch (e) {}
  const save = () => {
    try {
      sessionStorage.setItem('__mockNative', JSON.stringify({ tracking: NATIVE.tracking, points: NATIVE.points }));
    } catch (e) {}
  };

  window.__recordOnly = (p) => { NATIVE.points.push(p); save(); };
  window.__emitPoint = (p) => {
    NATIVE.points.push(p);
    save();
    window.postMessage({ type: 'gv-bridge-event', event: 'location.point', data: p }, '*');
  };
  window.__setTracking = (b) => { NATIVE.tracking = b; save(); };

  const reply = (id, ok, result, error) =>
    window.postMessage({ type: 'gv-bridge-response', id, ok, result, error }, '*');

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.type !== 'gv-bridge-request') return;
    if (!window.__calls) window.__calls = [];
    window.__calls.push({ action: m.action, params: m.params });
    switch (m.action) {
      case 'ping':
        return reply(m.id, true, { pong: true, shell: 'mock' });
      case 'location.setConfig':
        NATIVE.tracking = m.params.enabled === true;
        save();
        return reply(m.id, true, Object.assign({}, m.params, { tracking: NATIVE.tracking }));
      case 'location.start':
        NATIVE.tracking = true; save();
        return reply(m.id, true, { tracking: true });
      case 'location.stop':
        NATIVE.tracking = false; save();
        return reply(m.id, true, { tracking: false });
      case 'location.status':
        return reply(m.id, true, { tracking: NATIVE.tracking, points: NATIVE.points.length });
      case 'location.getHistory': {
        // 新壳契约：只回 ts > since 的点
        const since = Number(m.params?.since || 0);
        const pts = since > 0 ? NATIVE.points.filter((p) => p.ts > since) : NATIVE.points;
        return reply(m.id, true, { points: pts, rev: NATIVE.points.length });
      }
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
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['geolocation'],
  geolocation: { latitude: 31.2304, longitude: 121.4737 },
});
await ctx.addInitScript(MOCK);
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

const waitBoot = async () => {
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );
};
const calls = () => p.evaluate(() => window.__calls ?? []);
const geoCalls = () => p.evaluate(() => window.__geoCalls ?? -1);
const rowCount = () => p.locator('.music-list li').count();
const emitNative = async (label) => {
  const c = nextCoord();
  await p.evaluate((cc) => window.__emitPoint({ ts: Date.now(), lat: cc.lat, lng: cc.lng, accuracy: 8 }), c);
  await p.waitForTimeout(900);
  return c;
};

const toLocation = async () => {
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: '定位' }).first().click();
  await p.waitForTimeout(1200);
};
const openRecords = async () => {
  await toLocation();
  await p.getByRole('tab', { name: '记录' }).click();
  await p.waitForTimeout(600);
};

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(3000);
}

// ---- 建文件 ----
await toLocation();
await p.getByRole('tab', { name: '文件' }).click();
await p.waitForTimeout(400);
await p.locator('input[placeholder*="新文件名"]').fill('看门狗回归');
await p.getByRole('button', { name: '新建', exact: true }).click();
await p.waitForTimeout(1200);
check('新建后激活的是本文件', (await p.locator('.loc-card-head', { hasText: '看门狗回归' }).first().innerText()).includes('看门狗回归'));

console.log('\nA 手动开始连续打点（原生模式），不开自启动');
await p.getByRole('button', { name: '▶ 自动打点' }).click();
await p.waitForTimeout(1000);
const start = await calls();
check('推了 location.setConfig enabled=true', (start.filter((c) => c.action === 'location.setConfig').pop()?.params?.enabled) === true);
check('页面自己的 GPS 一次都没取（原生接管）', (await geoCalls()) === 0, `geoCalls=${await geoCalls()}`);
const c0 = await emitNative('pre-reload');
check('原生点落进文件', (await rowCount()) === 1, `rows=${await rowCount()}`);

console.log('\nA1 刷新（自启动仍关）：应凭 dr.autoLocation.enabled 自动接管');
await p.reload({ waitUntil: 'load' });
await waitBoot();
await p.waitForTimeout(2500);
await openRecords();
check('刷新后还是本文件', (await p.locator('.loc-card-head', { hasText: '看门狗回归' }).first().innerText()).includes('看门狗回归'));
check('刷新前那 1 个点还在', (await rowCount()) === 1, `rows=${await rowCount()}`);
const c1 = await emitNative('post-reload');
check('刷新后自动打点已接管（原生点仍落进来）', (await rowCount()) === 2, `rows=${await rowCount()}`);
check('接管后还是原生模式（页面 GPS 仍为 0）', (await geoCalls()) === 0, `geoCalls=${await geoCalls()}`);
check('head 仍有服务图标（在运行中）', (await p.locator('.page-head-right .hs-svc').count()) >= 1);

console.log('\nB 壳中途停止记录：原生看门狗应退回页面定时器');
const geoBefore = await geoCalls();
await p.evaluate(() => window.__setTracking(false));
// 看门狗约 18s（6s×3）宽限后才退，留足壳自起服务的时间，避免双记
await p.waitForTimeout(22000);
const geoAfter = await geoCalls();
check('壳停了之后页面退回页面定时器（开始用自己的 GPS）', geoAfter > geoBefore, `geoCalls ${geoBefore} → ${geoAfter}`);
await p.waitForTimeout(3500);
check('退回页面定时器后仍在打点（新增点）', (await rowCount()) >= 3, `rows=${await rowCount()}`);

// C 壳「假跑」：status 一直回 tracking=true，但一个点都不推。
// 这是刷新后打不上点的真正根因——壳的前台服务一启动就把 isRunning 置真，
// 可定位源压根没给它点（没授权 / 冷启失败），页面于是永远等不到点、
// 页面定时器又被 native:true 压着不排程，界面还显示「运行中」。
// 看门狗必须按「距上次收到点多久」判，而不是只听壳的 tracking。
console.log('\nC 壳假跑：tracking 一直是 true，但一个点都不推');
await p.getByRole('button', { name: '⏹ 停止自动打点' }).click();
await p.waitForTimeout(900);
await p.getByRole('button', { name: '▶ 自动打点' }).click();
await p.waitForTimeout(1200);
check('回到原生模式（页面 GPS 不动）', (await p.locator('.loc-native-hint').count()) === 1);
const geoC0 = await geoCalls();
const rowsC0 = await rowCount();
const trackC = await p.evaluate(() => window.__nativeState?.tracking);
check('壳这边确实报着 tracking=true（假跑的前提）', trackC === true, `tracking=${trackC}`);
// 25s 静默 + 补历史 + 再确认一次 ≈ 37s，留到 48s
await p.waitForTimeout(48000);
check('假跑被识破：页面接管开始用自己的 GPS', (await geoCalls()) > geoC0, `geoCalls ${geoC0} → ${await geoCalls()}`);
check('假跑识破后「原生接管」提示消失', (await p.locator('.loc-native-hint').count()) === 0);
check('页面接管后没有把已有点冲掉', (await rowCount()) >= rowsC0, `rows ${rowsC0} → ${await rowCount()}`);

console.log(`\n========== 汇总 ==========`);
if (failures.length) {
  console.log(`失败 ${failures.length} 项：${failures.join('、')}`);
  process.exitCode = 1;
} else {
  console.log('全部通过 ✓');
}
await browser.close();
