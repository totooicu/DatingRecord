// 一次性服务购买（付款充值测试线）e2e：网页 + 壳那份 Java 收费服务器，跨仓对同一份协议。
//
// 覆盖：
//   R1 没填服务器地址时买不动，页面把「没有可用收费服务器」说在人话里
//   R2 下单成功：两条渠道都在，scheme 前缀对（alipays:// / weixin:// + PAYMOCK-），
//      webUrl 被补成绝对地址；待支付出现 1 行
//   R3 「当它已付」→ 待支付清空、购买记录进 1 条、金额显示 ¥6.00、单号/交易号可见
//   R4 幂等：连发两次异步回调再查单，购买记录**还是 1 条**，只有「同步 N 次」在涨
//   R5 「继续支付」不攒单：连点两次，服务器上仍只有 1 张待支付（同服务同金额的 dedupe）
//   R6 取消是两步的：没确认前不许少；取消后的单不进购买记录
//   R7 收银台回跳那条路：带 ?orderId=&status=paid 重新打开页面 → 自己查单到账，
//      并且把这两个参数从地址栏抹掉（不然刷新又重查一次、还弹一条莫名其妙的「已到账」）
//   R8 刷新后记录还在（写的是库，不是内存）
//   R9 钱按分走、两边对得上账：页面 ¥6.00 / 服务器 amountCents=600，
//      服务器上的单子张数 == 页面下过的单
//
// 依赖：
//   · `npm run build` 后 preview 起 dist（默认 http://localhost:4173/）；
//   · 隔壁壳仓库（默认 /app/geckoview_example，可用 DR_SHELL 改）里那份
//     jsbridge/PayMock.java + DataShareServer.java + tools/pay-test/PayMockSelfTestServer.java
//     ——**协议只有这一份实现**，所以这里直接 javac 起来用它，不在 Node 里再抄一遍 mock。
//     只用 java.*，不需要 Android SDK。
//   · JDK 8+（沙箱 21）、Node 18+、全局 playwright（缺浏览器时退回 /usr/bin/chromium）。
// 用法：node tools/e2e/pay-one-time-e2e.mjs [url]   默认 http://localhost:4173/
//       环境变量：DR_SHELL 壳仓库路径 / PAY_PORT 端口（默认 41788）

import { spawn } from 'node:child_process';
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
const SHELL = process.env.DR_SHELL || path.resolve(process.cwd(), '..', 'geckoview_example');
const PORT = Number(process.env.PAY_PORT || 41788);
const BASE = `http://127.0.0.1:${PORT}`;
const CLASSES = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-paymock-'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-pay-e2e-'));

const failures = [];
const errors = [];
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures.push(label);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * 包一层点击：元素没出现时记一条失败继续往下跑，而不是让整条回归在 30 秒超时后崩掉。
 * 回归要能读完报告——后面还有六段没跑，崩在第三段等于什么都没验。
 */
const soft = async (label, fn) => {
  try {
    await fn();
    return true;
  } catch (e) {
    check(label, false, String(e?.message ?? e).split('\n')[0].slice(0, 90));
    return false;
  }
};

// ---------- 拉起壳那份收费服务器（真 Java，不是 Node 抄一份） ----------
const SRC = [
  'app/src/main/java/org/mozilla/geckoview_example/jsbridge/PayMock.java',
  'app/src/main/java/org/mozilla/geckoview_example/jsbridge/DataShareServer.java',
  'tools/pay-test/PayMockSelfTestServer.java',
];
const missing = SRC.filter((f) => !fs.existsSync(path.join(SHELL, f)));
if (missing.length) {
  console.error(`\n找不到壳仓库里的收费服务器实现：${SHELL}\n缺：${missing.join('、')}\n`);
  console.error('这条回归的意义就在于「协议只有一份实现」，所以不用 Node 假一个顶上去。');
  console.error('把壳仓库（test/payment-recharge 分支）放到 /app/geckoview_example，或用 DR_SHELL 指过去。');
  process.exit(1);
}

function run(cmd, args) {
  return new Promise((res, rej) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`${cmd} 退出 ${code}\n${out.slice(-800)}`))));
  });
}

console.log(`\n=== 一次性服务购买（网页 ${APP} × 壳收费服务器 ${BASE}）===`);
console.log(`壳仓库：${SHELL}`);

// javac 在本仓 cwd 里跑，源码路径必须是绝对的（相对路径会按当前目录找，跨仓就扑空）
await run('javac', ['-encoding', 'UTF-8', '-d', CLASSES, ...SRC.map((f) => path.join(SHELL, f))]);
console.log('  javac 编过：PayMock + DataShareServer + PayMockSelfTestServer');

const javaLogPath = path.join(TMP, 'paymock.log');
const javaLog = fs.openSync(javaLogPath, 'w');
const srv = spawn('java', ['-cp', CLASSES, 'org.mozilla.geckoview_example.jsbridge.PayMockSelfTestServer', String(PORT), 'e2e01'], {
  stdio: ['ignore', javaLog, javaLog],
});
let ready = false;
for (let i = 0; i < 60 && !ready; i += 1) {
  await sleep(300);
  ready = fs.readFileSync(javaLogPath, 'utf8').includes('READY');
  if (!ready && srv.exitCode !== null) break;
}
if (!ready) {
  console.error(`Java 服务器没起来（${BASE}）：\n${fs.readFileSync(javaLogPath, 'utf8').slice(-800)}`);
  process.exit(1);
}
const killSrv = () => {
  try {
    srv.kill();
  } catch {
    /* 已经没了 */
  }
};
process.on('exit', killSrv);

/** 直接问服务器，不经页面——跨仓对账用 */
async function api(p, init) {
  const r = await fetch(BASE + p, init);
  const t = await r.text();
  let j = null;
  try {
    j = t ? JSON.parse(t) : null;
  } catch {
    /* HTML（收银台）就原样返回 */
  }
  return { status: r.status, json: j, text: t, headers: r.headers };
}

// ---------- 浏览器 ----------
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));
p.on('console', (m) => {
  // Chromium 对被禁端口 / CORS 失败只报一条 net:: 文案，这里全收进 errors
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`);
});
p.on('dialog', (d) => d.accept());
// 元素不在也别等满 30 秒：失败项由 soft() 记下来，报告照样跑完
p.setDefaultTimeout(12000);

const waitBoot = async () => {
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );
};

const toPay = async () => {
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.waitForTimeout(400);
  for (let i = 0; i < 4; i += 1) {
    if (await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).first().isVisible().catch(() => false)) break;
    const back = p.locator('.back-btn').first();
    if (!(await back.count())) break;
    await back.click();
    await p.waitForTimeout(300);
  }
  await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).first().click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: '服务购买' }).first().click();
  await p.waitForTimeout(700);
};

const setBase = async (url) => {
  await p.locator('.pay-base-input').fill(url);
  await p.locator('.pay-base-save').click();
  await p.waitForTimeout(900);
};

const pendingRows = () => p.locator('.pay-pending .pay-order-row');
const purchaseRows = () => p.locator('.pay-purchases .pay-order-row');
const toastText = async () => (await p.locator('.toast').last().innerText().catch(() => '')).replace(/\s+/g, ' ');
const svcRow = (id) => p.locator(`.pay-service[data-service="${id}"]`);

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(2500);
}
await toPay();

console.log('\nR1 没有服务器地址时买不动');
{
  const state = await p.locator('.pay-base-state').innerText();
  check('页面直说没有可用收费服务器', /没有可用收费服务器/.test(state), state.replace(/\s+/g, ' ').slice(0, 80));
  const dis = await svcRow('ai.urgent').locator('.pay-channel-alipay').isDisabled();
  check('没地址时「支付宝」是灰的', dis === true);
}

console.log('\nR2 填地址 → 下单 → 两条渠道');
{
  await setBase(BASE);
  const state = await p.locator('.pay-base-state').innerText();
  check(`认了这台服务器（${BASE}）`, state.includes(BASE), state.replace(/\s+/g, ' ').slice(0, 80));

  await svcRow('ai.urgent').locator('.pay-channel-alipay').click();
  await p.waitForTimeout(1400);
  const t = await toastText();
  check('toast 报了单号', /已下单 PAY-\d{8}-\d{4}/.test(t), t);
  const orderId = (t.match(/PAY-\d{8}-\d{4}/) || [''])[0];
  check('待支付出现 1 行', (await pendingRows().count()) === 1, String(await pendingRows().count()));

  const ali = p.locator('.pay-jump[data-channel="alipay"]');
  const wx = p.locator('.pay-jump[data-channel="wechat"]');
  check('两条渠道都摆出来', (await ali.count()) === 1 && (await wx.count()) === 1);
  const scheme = await ali.locator('.pay-scheme').getAttribute('href');
  check('支付宝 scheme 结构对（alipays://…orderVo=PAYMOCK-单号）',
    /^alipays:\/\/.+orderVo=PAYMOCK-PAY-\d{8}-\d{4}$/.test(scheme ?? ''), scheme ?? '');
  const wxScheme = await wx.locator('.pay-scheme').getAttribute('href');
  check('微信 scheme 结构对（weixin://…prepayId=PAYMOCK-）', /^weixin:\/\/.+prepayId=PAYMOCK-/.test(wxScheme ?? ''), wxScheme ?? '');
  const web = await ali.locator('.pay-cashier').getAttribute('href');
  check('收银台被补成绝对地址（相对 webUrl 不能直接点）',
    (web ?? '').startsWith(`${BASE}/__pay/cashier?order=`) && (web ?? '').includes('channel=alipay'), web ?? '');
  check('收银台带着这张单的单号', (web ?? '').includes(orderId), `${orderId} vs ${web}`);
}

console.log('\nR3 已付 → 进购买记录');
{
  const row = pendingRows().first();
  await soft('R3 点到待支付行上的「当它已付」', () => row.locator('.pay-paid-fake').click());
  await p.waitForTimeout(1500);
  check('待支付清空', (await pendingRows().count()) === 0);
  check('购买记录 1 条', (await purchaseRows().count()) === 1);
  const txt = await purchaseRows().first().innerText();
  // 「当它已付」模拟的是服务器那侧的回调，不是收银台回跳——那条才弹「已到账」的 toast。
  // 这里要看的是页面自己把状态收敛到行上了：行上得写着「已到账」。
  check('行上收敛出「已到账」', /已到账/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 90));
  check('金额按元显示（¥6.00）', txt.includes('¥6.00'), txt.replace(/\s+/g, ' ').slice(0, 90));
  check('交易号落在行上（MOCK…）', /MOCK/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 120));
}

console.log('\nR4 重复回调不产生第二条记录');
{
  const before = (await purchaseRows().first().innerText()).match(/同步 (\d+) 次/);
  await soft('R4 点到「重复回调」', () => purchaseRows().first().locator('.pay-notify-twice').click());
  await p.waitForTimeout(2000);
  check('还是只有 1 条购买记录', (await purchaseRows().count()) === 1, String(await purchaseRows().count()));
  const after = (await purchaseRows().first().innerText()).match(/同步 (\d+) 次/);
  check(`同步次数在涨（${before?.[1]} → ${after?.[1]}），记录条数不涨`,
    Number(after?.[1] ?? 0) > Number(before?.[1] ?? 0), JSON.stringify({ b: before?.[1], a: after?.[1] }));
  const remote = await api(`/__pay/orders`);
  const mineId = await purchaseRows().first().getAttribute('data-order');
  const mine = (remote.json?.orders ?? []).filter((o) => o.orderId === mineId);
  check('服务器那侧也只有一个 tradeNo（没多记一笔交易）',
    mine.length === 1 && !!mine[0].tradeNo, JSON.stringify(mine.map((o) => o.tradeNo)));
}

console.log('\nR5 继续支付不攒新单');
{
  await svcRow('export.pdf').locator('.pay-channel-wechat').click();
  await p.waitForTimeout(1400);
  const first = await pendingRows().first().getAttribute('data-order');
  // 「试连」顺便验一次：页面直接问服务器要张数，跟本地看到的对得上
  await soft('R5 点到「试连」', () => p.locator('.pay-probe').click());
  await p.waitForTimeout(1200);
  const probe = await toastText();
  check(`试连报得出服务器上的单数（${probe}）`, /服务器上 \d+ 张单/.test(probe), probe);
  await soft('R5 点到「收起」', () => p.locator('.pay-jump-close').click());
  await p.waitForTimeout(300);
  await soft('R5 第一次「继续支付」', () => pendingRows().first().locator('.pay-resume').click());
  await p.waitForTimeout(1200);
  await soft('R5 第二次「继续支付」', () => pendingRows().first().locator('.pay-resume').click());
  await p.waitForTimeout(1400);
  check('待支付还是 1 行', (await pendingRows().count()) === 1, String(await pendingRows().count()));
  const now = await pendingRows().first().getAttribute('data-order');
  check(`还是同一张单（${first} → ${now}）`, first === now, `${first} / ${now}`);
  const remote = await api('/__pay/orders');
  const pend = (remote.json?.orders ?? []).filter((o) => o.status === 'pending');
  check(`服务器上也只有 1 张待支付（${pend.length}）`, pend.length === 1, JSON.stringify(pend.map((o) => o.orderId)));
}

console.log('\nR6 取消是两步的，取消掉的单不进购买记录');
{
  const n = await pendingRows().count();
  await soft('R6 点「取消支付」', () => pendingRows().first().locator('.pay-cancel').click());
  await p.waitForTimeout(300);
  check('点一下只出确认条，没立刻取消', (await pendingRows().count()) === n && (await p.locator('.pay-cancel .confirm-acts, .confirm-acts').count()) >= 1);
  await soft('R6 点确认条上的「取消」按钮（不动作）', () => p.locator('.confirm-acts').first().locator('.btn-ghost').click());
  await p.waitForTimeout(400);
  check('按「取消」这条按钮不动它', (await pendingRows().count()) === n);
  await soft('R6 再点一次「取消支付」', () => pendingRows().first().locator('.pay-cancel').click());
  await p.waitForTimeout(300);
  await soft('R6 点确认条上的「确定」', () => p.locator('.confirm-acts').first().locator('.btn-danger').click());
  await p.waitForTimeout(1500);
  check('确认后才少一行', (await pendingRows().count()) === n - 1, `${n} → ${await pendingRows().count()}`);
  check('已取消的单不算购买记录', (await purchaseRows().count()) === 1, String(await purchaseRows().count()));
}

console.log('\nR7 收银台回跳那一条路（页面自己查单收敛）');
{
  // 先造一张已付的单：下单 → 让服务器付掉 → 模拟「从 app 退回来」带 ?orderId=&status=paid
  await soft('R7 点「分享页去标识」的支付宝', () => svcRow('share.pro').locator('.pay-channel-alipay').click());
  await p.waitForTimeout(1400);
  const id = await pendingRows().first().getAttribute('data-order');
  const r = await api(`/__pay/order?id=${encodeURIComponent(id)}&action=pay`, { method: 'POST' });
  check('服务器把这张单标成已付', r.json?.status === 'paid', JSON.stringify(r.json));
  await p.goto(`${APP}?orderId=${encodeURIComponent(id)}&status=paid`, { waitUntil: 'load' });
  await waitBoot();
  await toPay();
  const t = await toastText();
  check('回来就自己查单并报「已到账」', /已到账/.test(t), t);
  check('地址栏那两个参数被抹掉了', !(await p.evaluate(() => location.search)).includes('orderId='), await p.evaluate(() => location.search));
  check('购买记录变 2 条', (await purchaseRows().count()) === 2, String(await purchaseRows().count()));
  const share = purchaseRows().filter({ hasText: '分享页去标识' });
  check('¥30.00 那笔也在', (await share.count()) === 1 && (await share.innerText()).includes('¥30.00'));
}

console.log('\nR8 刷新后还在（落的是库）');
{
  await sleep(1200); // 防抖整库落盘
  await p.reload({ waitUntil: 'load' });
  await waitBoot();
  await toPay();
  check('刷新后购买记录还是 2 条', (await purchaseRows().count()) === 2, String(await purchaseRows().count()));
  const base = await p.locator('.pay-base-state').innerText();
  check('服务器地址也记住了（设备偏好）', base.includes(BASE), base.replace(/\s+/g, ' ').slice(0, 70));
}

console.log('\nR9 两边对账：分是单位，张数对得上');
{
  const remote = await api('/__pay/orders');
  const orders = remote.json?.orders ?? [];
  const local = await purchaseRows().count();
  const cancelled = orders.filter((o) => o.status === 'cancelled').length;
  const stillPending = orders.filter((o) => o.status === 'pending').length;
  check(`服务器 ${orders.length} 张 = 已付 ${local} + 已取消 ${cancelled} + 待支付 ${stillPending}`,
    orders.length === local + cancelled + stillPending && local === 2,
    JSON.stringify({ all: orders.length, local, cancelled, stillPending }));
  check('服务器存的是分（600 / 1200 / 3000），不是元',
    orders.every((o) => Number.isInteger(o.amountCents) && o.amountCents >= 100),
    JSON.stringify(orders.map((o) => o.amountCents)));
  check('跨域头带着（页面才连得上壳的服务器）',
    (remote.headers.get('access-control-allow-origin') ?? '') === '*',
    String(remote.headers.get('access-control-allow-origin')));
  const spent = await p.locator('.pay-spent').first().innerText();
  check('合计金额按已付的两笔算（¥36.00）', /花掉 ¥36\.00/.test(spent.replace(/\s+/g, ' ')), spent.replace(/\s+/g, ' '));
}

console.log('\nR10 服务器会把胡来的状态转换挡掉');
{
  const id = await purchaseRows().first().getAttribute('data-order');
  const bad = await api(`/__pay/order?id=${encodeURIComponent(id)}&action=cancel`, { method: 'POST' });
  check('已付的单不能再取消（409 bad_transition）', bad.status === 409 && bad.json?.error === 'bad_transition', `${bad.status} ${JSON.stringify(bad.json)}`);
  const ghost = await api('/__pay/order?id=PAY-19700101-0001');
  check('不存在的单 404 order_not_found', ghost.status === 404 && ghost.json?.error === 'order_not_found', `${ghost.status}`);
}

console.log(`\n========== 汇总 ==========`);
console.log(`失败 ${failures.length} 项${failures.length ? `：${failures.join(' / ')}` : ''}`);
console.log(`控制台 / 页面错误 ${errors.length} 项${errors.length ? `：${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
killSrv();
fs.rmSync(CLASSES, { recursive: true, force: true });
if (failures.length || errors.length) process.exit(1);
console.log('\n全部通过 ✓');
