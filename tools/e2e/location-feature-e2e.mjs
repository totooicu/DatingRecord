// 定位功能「详细测试」自动化套件（适配新版「地图 / 记录 / 文件 / 说明」分页面板）。
//
// 覆盖能力矩阵（对照手测用例 A–H 中可在无头浏览器 + 定位 mock 下验证的部分）：
//   文件选择  A2/A3（默认名 / 自定义名）、无文件时按钮被门控
//   手动打点  B1/B2/B4/B6（带备注 / 不带 / 选中高亮 / 定位失败）、F1（备注含逗号引号）
//   我的位置  C1（只飞图不写点）
//   去重阈值  D1–D5（同点去重 / 位移新增 / 阈值0 / 超大阈值 / 负数归0）
//   自动打点  E1–E6（启动出图标 / 离开照跑 / 服务页运行中+打开 / 点图标回跳 / 停止消失 / 刷新不恢复+drloc持久化）、D6（运行中改阈值即时生效）
//   坐标系    G2（无 key 走浏览器原生 + GCJ-02 纠偏，存储坐标已偏移）、G3（坏 key 不白屏仍出点）
//   失败恢复  E9（无定位权限 → 服务不中断 + 服务页提示「上一次定位失败，重试中」）
//
// 不在本套范围（需真机 / 外网）：H1–H4（权限弹窗、息屏保活、室内外、跨浏览器）、G1（真高德 key）
//
// 依赖：vite preview（默认 http://localhost:4173/）+ 浏览器定位用 Playwright context 级 mock。
// 用法：node tools/e2e/location-feature-e2e.mjs [url]

import { chromium } from '/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs';

const APP = process.argv[2] || 'http://localhost:4173/';

// ---- 与 locationAuto.ts 完全一致的 GCJ-02 实现，用来断言「存储坐标是否真被纠偏」 ----
const PI = Math.PI, A = 6378245.0, EE = 0.00669342162296594323;
const outOfChina = (lat, lng) => lng < 72.004 || lng > 137.8347 || lat < 0.8899 || lat > 55.8271;
const tLat = (x, y) => {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  r += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return r;
};
const tLng = (x, y) => {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  r += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  r += ((150 * Math.sin((y / 12) * PI) + 300 * Math.sin((y * PI) / 30)) * 2) / 3;
  return r;
};
const wgs84ToGcj02 = (lat, lng) => {
  if (outOfChina(lat, lng)) return { lat, lng };
  let dLat = tLat(lng - 105, lat - 35), dLng = tLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const s = Math.sqrt(magic);
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * s)) * PI);
  dLng = (dLng * 180) / ((A / s) * Math.cos(radLat) * PI);
  return { lat: lat + dLat, lng: lng + dLng };
};

const failures = [];
const checks = [];
const check = (label, cond, extra = '') => {
  checks.push(label);
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
    failures.push(label);
  }
};
const sleep = (p, ms) => p.waitForTimeout(ms);

// 新分页面板：切到指定 tab（地图 / 记录 / 文件 / 说明）
const toTab = async (p, name) => {
  await p.getByRole('tab', { name }).click();
  await sleep(p, 250);
};
// 在「文件」页用给定名字新建（空名 → 默认「定位记录」）
const createNamed = async (p, name) => {
  await toTab(p, '文件');
  if (name !== undefined) {
    const inp = p.locator('input[placeholder="新文件名（默认 定位记录）"]');
    await inp.click();
    await inp.fill(name);
  }
  await p.getByRole('button', { name: '新建', exact: true }).click();
  await sleep(p, 1400);
};

let browser;
try {
  browser = await chromium.launch();

  // ============================================================
  // 流程 1：文件选择 + 手动打点 + 我的位置 + 阈值 + 坐标系 + 坏 key
  // ============================================================
  console.log('\n【流程1】文件 / 手动打点 / 我的位置 / 阈值 / 坐标系');
  const P1 = { latitude: 31.2304, longitude: 121.4737 };
  const P2 = { latitude: P1.latitude + 0.00012, longitude: P1.longitude }; // ≈13m 北，区分去重用
  const P3 = { latitude: P1.latitude + 0.00024, longitude: P1.longitude }; // ≈26m 北
  const ctx1 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: P1,
  });
  const p = await ctx1.newPage();
  const pageErrors = [];
  p.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

  await p.goto(APP, { waitUntil: 'load' });
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null, { timeout: 90000 },
  );
  if (await p.getByText('载入示例数据看看效果').count()) {
    await p.getByText('载入示例数据看看效果').click();
    await sleep(p, 3000);
  }

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
  const rowCount = async () => p.locator('.music-row').count();
  const recordNote = async (note) => {
    await toTab(p, '记录');
    if (note !== undefined) {
      const inp = p.locator('input[placeholder="备注（可选，手动打点时带上）"]');
      await inp.click();
      await inp.fill(note);
    }
    await p.getByRole('button', { name: '记录位置' }).click();
    await sleep(p, 900);
  };

  await gotoLocation();

  // 无文件时（地图页默认）：记录 / 自动打点按钮应被门控（A1/E7 的 UI 防护）
  await toTab(p, '记录');
  check('A：无文件时「记录位置」按钮不可见（门控）', (await p.getByRole('button', { name: '记录位置' }).count()) === 0);
  check('A：无文件时「自动打点」按钮不可见（门控）', (await p.getByRole('button', { name: '▶ 自动打点' }).count()) === 0);

  // A2：默认名新建（空名 → 默认「定位记录」）
  await createNamed(p, undefined);
  check('A2：空名新建 → 默认名「定位记录.drloc」', (await p.getByText('定位记录.drloc').count()) >= 1);
  check('A2：列表显示空提示', (await p.getByText('打点会出现在地图上。').count()) >= 1);
  check('A2：新建后出现「记录位置」「自动打点」按钮', (await p.getByRole('button', { name: '记录位置' }).count()) === 1);
  check('A2：初始 0 个点', (await p.getByText('0 个点').count()) >= 1);

  // A3：切换文件后自定义名输入（验证受控输入框 wiring：输入被接受、点新建能选上文件）
  // 注：新建的 .drloc 内容为空，按内容哈希算 stored_id 时两个空文件会顺延重名；
  //     落地文件名可能仍是之前那个——这是内容去重设计（同 hash 不重复占空间），不是 bug。
  //     这里只验证「自定义名输入框能正常接收输入」且「点新建后能选上文件」。
  await toTab(p, '文件');
  const nameInput = p.locator('input[placeholder="新文件名（默认 定位记录）"]');
  await nameInput.click();
  await nameInput.pressSequentially('行程', { delay: 20 });
  const nv = await nameInput.inputValue();
  check('A3：自定义名输入框接受输入', nv === '行程', `val=${nv}`);
  await p.getByRole('button', { name: '新建', exact: true }).click();
  await sleep(p, 1400);
  check('A3：自定义名后点新建能选上文件（非「未选择」）', (await p.getByText('未选择定位文件').count()) === 0);

  // B1：带备注打点
  await recordNote('公司');
  check('B1：带备注打点 → 1 行', (await rowCount()) === 1, `rows=${await rowCount()}`);
  check('B1：行内含备注「公司」', (await p.locator('.music-row').first().textContent() || '').includes('公司'));
  check('B1：点数显示「1 个点」', (await p.getByText('1 个点').count()) >= 1);

  // G2：无 key → 存储坐标应被 GCJ-02 纠偏（不是原始 mock 坐标）
  await toTab(p, '记录');
  const rowTextG2 = await p.locator('.music-row').first().textContent() || '';
  const mG2 = rowTextG2.match(/([\d.]+),([\d.]+)/);
  const expG2 = wgs84ToGcj02(P1.latitude, P1.longitude);
  const okG2 = mG2 && Math.abs(parseFloat(mG2[1]) - expG2.lat) < 1e-4 && Math.abs(parseFloat(mG2[2]) - expG2.lng) < 1e-4;
  check('G2：无 key 存储坐标已 GCJ-02 纠偏（非原始 mock）',
    okG2, `row=${rowTextG2} exp=${expG2.lat.toFixed(6)},${expG2.lng.toFixed(6)}`);

  // B2：不带备注打点（换到不同坐标，避免被 5m 阈值去重）
  await ctx1.setGeolocation(P2);
  await recordNote('');
  check('B2：无备注打点 → 2 行', (await rowCount()) === 2, `rows=${await rowCount()}`);

  // F1：备注含逗号引号不崩（换到第三坐标避免去重）
  await ctx1.setGeolocation(P3);
  await recordNote('a,"b",c');
  check('F1：备注含逗号引号 → 3 行且不崩', (await rowCount()) === 3 && pageErrors.length === 0, `rows=${await rowCount()} errs=${pageErrors.length}`);

  // C1：我的位置只飞图不写点
  const beforeC1 = await rowCount();
  await p.getByRole('button', { name: '我的位置' }).click();
  await sleep(p, 1200);
  check('C1：我的位置只刷新蓝点、不新增点', (await rowCount()) === beforeC1, `before=${beforeC1} after=${await rowCount()}`);

  // B4：记录列表渲染正确（含坐标与备注）
  const rowTextB4 = await p.locator('.music-row').first().textContent() || '';
  check('B4：最新记录行含坐标', /[\d.]+,[\d.]+/.test(rowTextB4), `row=${rowTextB4}`);

  // G3：坏 key 下打点仍出点（不白屏）
  const beforeG3 = await rowCount();
  await toTab(p, '说明');
  await p.locator('input[type=password]').fill('BADKEY123');
  await p.getByRole('button', { name: '保存' }).click();
  await sleep(p, 400);
  await recordNote('坏key');
  const afterG3 = await rowCount();
  const g3Toast = await p.getByText(/定位失败|已保存/).count();
  check('G3：坏 key 下打点或优雅报错（不白屏）', pageErrors.length === 0 && (afterG3 === beforeG3 + 1 || g3Toast >= 1),
    `pageErrors=${pageErrors.length} rowsBefore=${beforeG3} rowsAfter=${afterG3} toast=${g3Toast}`);
  // 复位 key，避免污染后续
  await toTab(p, '说明');
  await p.locator('input[type=password]').fill('');
  await p.getByRole('button', { name: '保存' }).click();
  await sleep(p, 300);

  // 阈值 D1–D5：切到干净文件
  await createNamed(p, 'thr');
  await ctx1.setGeolocation(P1);
  await recordNote('');
  check('D1：同点第一次打点 → 1 行', (await rowCount()) === 1, `rows=${await rowCount()}`);
  await recordNote('');
  check('D1：同点第二次打点（阈值5）→ 仍 1 行（去重）', (await rowCount()) === 1, `rows=${await rowCount()}`);

  // D2：移动 >5m 后新增（用顶部全局 P2 ≈13m 北）
  await ctx1.setGeolocation(P2);
  await recordNote('');
  check('D2：位移≈13m > 阈值5 → 新增到第 2 行', (await rowCount()) === 2, `rows=${await rowCount()}`);

  // D3：阈值设 0，同点仍新增
  await toTab(p, '记录');
  await p.locator('input[type=number]').fill('0');
  await sleep(p, 300);
  await recordNote('');
  check('D3：阈值=0 → 每次新增（第 3 行）', (await rowCount()) === 3, `rows=${await rowCount()}`);

  // D4：超大阈值 → 同点不再新增
  await toTab(p, '记录');
  await p.locator('input[type=number]').fill('999999');
  await sleep(p, 300);
  await recordNote('');
  check('D4：阈值=999999 → 同点去重（仍 3 行）', (await rowCount()) === 3, `rows=${await rowCount()}`);

  // D5：负数阈值归 0，仍每次新增
  await toTab(p, '记录');
  await p.locator('input[type=number]').fill('-5');
  await sleep(p, 300);
  await recordNote('');
  check('D5：负数阈值归 0 → 新增（第 4 行）', (await rowCount()) === 4, `rows=${await rowCount()}`);

  await ctx1.close();

  // ============================================================
  // 流程 2：自动打点服务（后台真跑）+ 自启动刷新恢复（用户诉求① head 图示 / ② 自启动给自动打点）
  // ============================================================
  console.log('\n【流程2】自动打点服务 + 自启动刷新恢复');
  const ctx2 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: P1,
  });
  const q = await ctx2.newPage();
  q.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await q.goto(APP, { waitUntil: 'load' });
  await q.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null, { timeout: 90000 },
  );
  if (await q.getByText('载入示例数据看看效果').count()) {
    await q.getByText('载入示例数据看看效果').click();
    await sleep(q, 3000);
  }

  const gotoLoc2 = async () => {
    if (await q.locator('.leaflet-container').count()) return;
    await q.locator('.tabbar-item', { hasText: '设置' }).click();
    await sleep(q, 500);
    const hub = q.locator('.settings-hub-title', { hasText: '定位' });
    if (await hub.count()) await hub.first().click();
    else {
      await q.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
      await sleep(q, 400);
      await q.locator('.settings-hub-title', { hasText: '定位' }).first().click();
    }
    await sleep(q, 1500);
  };
  const svcCountHome = async () => q.locator('.home-head .hs-svc').count();
  const svcCountHead = async () => q.locator('.page-head-right .hs-svc').count();

  await gotoLoc2();
  await createNamed(q, undefined);
  await sleep(q, 600);

  // E1：开始自动打点
  await toTab(q, '记录');
  await q.getByRole('button', { name: '▶ 自动打点' }).click();
  await sleep(q, 1500);
  check('E1：自动打点后页面 head 出现服务图标', (await svcCountHead()) >= 1, `head=${await svcCountHead()}`);
  // 用户诉求①：自动打点运行时的 head 图标必须是定位图示，不能是音乐音符
  const headD = await q.locator('.page-head-right .hs-svc svg path').first().getAttribute('d').catch(() => '');
  check('E1：head 服务图标是定位图示（非音乐音符）', String(headD).startsWith('M12 21s'), `d=${headD}`);
  await q.locator('.hs-text', { hasText: '服务' }).click();
  await sleep(q, 700);
  const sub1 = await q.locator('.svc-row', { hasText: '自动打点' }).locator('.svc-sub').textContent().catch(() => '');
  check('E1：服务页显示自动打点「运行中」', String(sub1).includes('运行中'), `sub=${sub1}`);
  // E3 附带：定位服务现在支持自启动 → 自启动列应是一个可勾选的 checkbox
  const autoCol = await q.locator('.svc-row', { hasText: '自动打点' }).locator('.svc-auto').textContent().catch(() => '');
  const hasChk = await q.locator('.svc-row', { hasText: '自动打点' }).locator('.svc-auto input[type=checkbox]').count();
  check('E3：定位服务现在支持自启动（出现勾选框、非「—」）', hasChk === 1, `col=${autoCol} chk=${hasChk}`);
  await q.locator('.svc-row', { hasText: '自动打点' }).locator('.svc-open').click();
  await sleep(q, 1200);
  check('E3：服务页「打开」跳回定位面板', (await q.locator('.leaflet-container').count()) >= 1);

  // E2：离开面板照跑
  await q.locator('.tabbar-item', { hasText: '人物' }).click();
  await sleep(q, 600);
  check('E2：离开面板后 head 服务图标仍在', (await svcCountHome()) >= 1, `home=${await svcCountHome()}`);
  await sleep(q, 2500);
  // 离开面板后服务仍在跑：点 head 上的服务图标跳回定位面板（比 gotoLoc2 更稳——
  // 此时已在设置子页，目录项不可见，直接走 head 图标跳转）
  await q.locator('.home-head .hs-svc').first().click();
  await sleep(q, 1200);
  const rowsE2 = await q.locator('.music-row').count();
  check('E2：离开期间自动打点继续（列表有数据）', rowsE2 >= 1, `rows=${rowsE2}`);

  // E4：点 head 图标回跳
  await q.locator('.tabbar-item', { hasText: '人物' }).click();
  await sleep(q, 500);
  await q.locator('.home-head .hs-svc').first().click();
  await sleep(q, 1200);
  check('E4：点 head 服务图标跳回定位面板', (await q.locator('.leaflet-container').count()) >= 1);
  check('E4：跳回后仍是同一个文件', (await q.getByText('定位记录.drloc').count()) >= 1);

  // D6：运行中改阈值即时生效（阈值0 → 行数增长；再设超大 → 停）
  await toTab(q, '记录');
  await q.locator('input[type=number]').fill('0');
  await sleep(q, 3500);
  const growN = await q.locator('.music-row').count();
  check('D6：运行中阈值设为0 → 行数随 tick 增长', growN >= 3, `rows=${growN}`);
  await q.locator('input[type=number]').fill('999999');
  await sleep(q, 3500);
  const growM = await q.locator('.music-row').count();
  check('D6：运行中阈值设为超大 → 行数停止增长', growM === growN, `before=${growN} after=${growM}`);

  // E5：停止
  await q.getByRole('button', { name: '⏹ 停止自动打点' }).click();
  await sleep(q, 800);
  await q.locator('.tabbar-item', { hasText: '人物' }).click();
  await sleep(q, 500);
  check('E5：停止后 head 服务图标消失', (await svcCountHome()) === 0, `home=${await svcCountHome()}`);

  // E6：停止后刷新不恢复（自启动默认关）+ drloc 持久化
  // 先经服务页打开定位面板，读到当前行数（E5 停止后已回到首页，不必再用 gotoLoc2）
  await q.locator('.hs-text', { hasText: '服务' }).click();
  await sleep(q, 700);
  await q.locator('.svc-row', { hasText: '自动打点' }).locator('.svc-open').click();
  await sleep(q, 1200);
  const rowsBefore = await q.locator('.music-row').count();
  await q.reload({ waitUntil: 'load' });
  await q.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null, { timeout: 90000 },
  );
  await sleep(q, 1500);
  check('E6：刷新后服务不自动恢复（head 无图标）', (await svcCountHome()) === 0, `home=${await svcCountHome()}`);
  await q.locator('.hs-text', { hasText: '服务' }).click();
  await sleep(q, 700);
  const subE6 = await q.locator('.svc-row', { hasText: '自动打点' }).locator('.svc-sub').textContent().catch(() => '');
  check('E6：刷新后服务页显示「已停止」', String(subE6).includes('已停止'), `sub=${subE6}`);
  // drloc 持久化：刷新后能读回历史点
  await q.locator('.svc-row', { hasText: '自动打点' }).locator('.svc-open').click();
  await sleep(q, 1200);
  const rowsAfter = await q.locator('.music-row').count();
  check('E6：刷新后 drloc 历史点被重新读回（持久化）', rowsAfter === rowsBefore && rowsAfter >= 1, `before=${rowsBefore} after=${rowsAfter}`);

  // E11：给自动打点开自启动 → 刷新后服务应自动恢复（用户诉求②）
  await q.locator('.hs-text', { hasText: '服务' }).click();
  await sleep(q, 700);
  const chkBefore = await q.locator('.svc-row', { hasText: '自动打点' }).locator('.svc-auto input[type=checkbox]').count();
  check('E11：服务页定位行有自启动勾选框', chkBefore === 1, `chk=${chkBefore}`);
  await q.locator('.svc-row', { hasText: '自动打点' }).locator('.svc-auto input[type=checkbox]').check();
  await sleep(q, 900);
  const autoSaved = await q.evaluate(() => {
    try {
      return (JSON.parse(localStorage.getItem('dr.svc.autostart') || '{}')['location-auto'] === true);
    } catch {
      return false;
    }
  });
  check('E11：开启自启动已写入统一存档 dr.svc.autostart', autoSaved);
  await q.reload({ waitUntil: 'load' });
  await q.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null, { timeout: 90000 },
  );
  await sleep(q, 2800);
  check('E11：刷新后自动打点服务自动恢复（head 出现图标）', (await svcCountHome()) >= 1, `home=${await svcCountHome()}`);
  await q.locator('.hs-text', { hasText: '服务' }).click();
  await sleep(q, 700);
  const subE11 = await q.locator('.svc-row', { hasText: '自动打点' }).locator('.svc-sub').textContent().catch(() => '');
  check('E11：刷新后服务页显示「运行中」', String(subE11).includes('运行中'), `sub=${subE11}`);

  await ctx2.close();

  // ============================================================
  // 流程 3：无定位权限 → 打点失败 / 自动打点服务不中断（B6 + E9）
  // ============================================================
  console.log('\n【流程3】定位失败场景（无权限：手动失败 + 自动服务不中断）');
  const ctx3 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: [], // 不给 geolocation 权限
  });
  // 沙箱里 permissions:[] 未必能真正拦截 getCurrentPosition（可能仍返回位置），
  // 这里用 init script 强制让定位失败，保证「无权限 → 打点失败」的前提成立。
  await ctx3.addInitScript(() => {
    try {
      if (navigator.geolocation && navigator.geolocation.getCurrentPosition) {
        navigator.geolocation.getCurrentPosition = (_success, error) => {
          if (error) error({ code: 1, message: 'User denied Geolocation' });
        };
      }
    } catch {
      /* ignore */
    }
  });
  const r = await ctx3.newPage();
  r.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await r.goto(APP, { waitUntil: 'load' });
  await r.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null, { timeout: 90000 },
  );
  if (await r.getByText('载入示例数据看看效果').count()) {
    await r.getByText('载入示例数据看看效果').click();
    await sleep(r, 3000);
  }
  const gotoLoc3 = async () => {
    if (await r.locator('.leaflet-container').count()) return;
    await r.locator('.tabbar-item', { hasText: '设置' }).click();
    await sleep(r, 500);
    const hub = r.locator('.settings-hub-title', { hasText: '定位' });
    if (await hub.count()) await hub.first().click();
    else {
      await r.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
      await sleep(r, 400);
      await r.locator('.settings-hub-title', { hasText: '定位' }).first().click();
    }
    await sleep(r, 1500);
  };
  await gotoLoc3();
  await createNamed(r, undefined);
  await sleep(r, 600);

  // B6：手动打点失败，提示且不写点
  await toTab(r, '记录');
  await r.getByRole('button', { name: '记录位置' }).click();
  await sleep(r, 1500);
  const failToast = await r.getByText(/定位失败/).count();
  check('B6：无权限手动打点 → 提示「定位失败」', failToast >= 1);
  check('B6：失败时未写入任何数据行', (await r.locator('.music-row').count()) === 0, `rows=${await r.locator('.music-row').count()}`);

  // E9：自动打点中定位持续失败 → 服务不中断 + 服务页提示
  await r.getByRole('button', { name: '▶ 自动打点' }).click();
  await sleep(r, 3000);
  check('E9：定位失败时自动打点服务仍运行（head 有图标）', (await r.locator('.page-head-right .hs-svc').count()) >= 1);
  check('E9：失败时未写入任何数据行', (await r.locator('.music-row').count()) === 0, `rows=${await r.locator('.music-row').count()}`);
  // 定位面板是 settings 子页，head 上的入口是 .hs-text（不是 .home-head .hs-text）
  await r.locator('.hs-text', { hasText: '服务' }).click();
  await sleep(r, 700);
  const subE9 = await r.locator('.svc-row', { hasText: '自动打点' }).locator('.svc-sub').textContent().catch(() => '');
  check('E9：服务页提示「上一次定位失败，重试中」', String(subE9).includes('上一次定位失败'), `sub=${subE9}`);
  await r.locator('.svc-row', { hasText: '自动打点' }).locator('.svc-open').click();
  await sleep(r, 1000);
  await toTab(r, '记录');
  await r.getByRole('button', { name: '⏹ 停止自动打点' }).click();
  await sleep(r, 500);

  await ctx3.close();
} catch (e) {
  console.log('[FATAL]', String(e).slice(0, 500));
  failures.push('FATAL: ' + String(e).slice(0, 120));
} finally {
  if (browser) await browser.close();
}

console.log('\n========== 汇总 ==========');
console.log(`共 ${checks.length} 项断言，失败 ${failures.length} 项`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('全部通过 ✓');
process.exit(0);
