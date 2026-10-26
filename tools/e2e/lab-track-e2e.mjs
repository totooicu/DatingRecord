// 轨迹提取 e2e：选图 → 提取 → AI 校准 → 三层对比 → 地图复现 → 存成定位文件。
//
// 覆盖这一页最容易坏掉的几处：
//   T1 选图卡是按钮 + 拖拽区（不是裸的原生 file 控件），选中后显示文件名/尺寸
//   T2 提取轨迹出结果，画布上真的画上了东西
//   T3 AI 校准打到模型上（带 image_url），AI 层出现在画布上，给出偏差读数
//   T4 「原图 / 提取的轨迹 / AI 提取的轨迹」复选框真的控制图层（逐层开关画布内容变化）
//   T5 地图复现：地图初始化、可点起点、复现推进里程、可停止
//   T6 保存为 .drloc：出现在「功能面板 → 定位 → 文件」里，点开能看到点数
//
// 依赖：先 `pnpm build`。自带静态服务器（dist）与假视觉模型服务，直接跑：
//   node tools/e2e/lab-track-e2e.mjs
// 也可以用 node tools/e2e/lab-track-e2e.mjs http://localhost:4173/ 指到已起的服务。

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const DIST = path.resolve('dist');
const STATIC_PORT = Number(process.env.STATIC_PORT ?? 4189);
const VISION_PORT = Number(process.env.VISION_PORT ?? 8795);
const APP = process.argv[2] || `http://127.0.0.1:${STATIC_PORT}/`;
const FAKE = `http://127.0.0.1:${VISION_PORT}/v1`;

const failures = [];
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures.push(label);
};

/* ---------- 假视觉模型：返回一条贴着实测曲线的归一化轨迹 ---------- */

// 一条螺旋线：真实轨迹都是弯的，骨架长明显超过包围盒对角线，
// 直一点的折线会被提取器的「像圆形图标（骨架不弯）」校准丢掉。
const PICKS = 60;
const CURVE = Array.from({ length: PICKS }, (_, i) => {
  const t = i / (PICKS - 1);
  const a = 2.2 * Math.PI * t;
  const r = 220 * (1 - 0.55 * t);
  return { x: 300 + r * Math.cos(a), y: 300 + r * Math.sin(a) };
});

const visionStats = { calls: 0, withImage: 0 };
const vision = http.createServer((req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/stats')) {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify(visionStats));
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      /* ignore */
    }
    const parts = (body.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    visionStats.calls += 1;
    if (parts.some((x) => x?.type === 'image_url' && x.image_url?.url?.startsWith('data:image/'))) visionStats.withImage += 1;

    // AI 的轨迹：同一条曲线，整体偏 3px，模拟「大方向对、细节有差」
    const polyline = CURVE.map((pt) => ({
      x: Number(((pt.x + 3) / 600).toFixed(4)),
      y: Number(((pt.y - 3) / 600).toFixed(4)),
    }));
    const content = JSON.stringify({
      polyline,
      scale: { meter: 500, px: 100 },
      mileageKm: 6.4,
      startName: '假起点',
      endName: '假终点',
      startGeo: { lat: 30.2741, lng: 120.1551 },
      endGeo: null,
      northDeg: 0,
      notes: 'e2e 假模型：沿红色折线取样',
    });
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'x',
        object: 'chat.completion',
        created: 1,
        model: 'fake-vision',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
});

/* ---------- 静态服务器 ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const staticServer = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.join(DIST, url);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => vision.listen(VISION_PORT, '127.0.0.1', r));
await new Promise((r) => staticServer.listen(STATIC_PORT, '127.0.0.1', r));

/* ---------- 截图：600×600 白底 + 一条红色折线 + 两个红色噪点 ---------- */

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
  <rect width="600" height="600" fill="#ffffff"/>
  <polyline points="${CURVE.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"
    fill="none" stroke="#e00000" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="522" cy="530" r="18" fill="#e00000"/>
  <rect x="20" y="20" width="28" height="28" rx="6" fill="#e00000"/>
</svg>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
p.on('console', (m) => {
  if (m.type() === 'error') console.log('[console/error]', m.text().slice(0, 240));
});

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

const toLabTrack = async () => {
  await toSettingsRoot();
  await p.locator('.settings-nav-title', { hasText: /^功能体验$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: '轨迹提取' }).click();
  await p.waitForTimeout(700);
};

const toLocationFiles = async () => {
  await toSettingsRoot();
  await p.locator('.settings-nav-title', { hasText: /^功能面板$/ }).click();
  await p.waitForTimeout(400);
  await p.locator('.settings-hub-title', { hasText: '定位' }).first().click();
  await p.waitForTimeout(1200);
  await p.locator('.loc-panel .aichat-tab', { hasText: '文件' }).click();
  await p.waitForTimeout(400);
};

const status = async () => (await p.locator('.lab-track-status').innerText()).replace(/\s+/g, ' ').trim();

/** 画布内容指纹：逐像素求和，用来判断图层开关有没有真的重绘 */
const canvasSum = () =>
  p.evaluate(() => {
    const c = document.querySelector('.lab-track-canvas');
    if (!c) return -1;
    const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    let s = 0;
    for (let i = 0; i < data.length; i += 4) s = (s + data[i] + data[i + 1] + data[i + 2]) % 1e12;
    return s;
  });

console.log('\n=== 轨迹提取 端到端 ===');

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(2500);
}

// 地图瓦片走外网，跑测试时直接拦掉：只验证 Leaflet 与轨迹层，不等瓦片
await p.route('**/appmaptile**', (r) => r.abort());

await toSettingsRoot();
await p.locator('.settings-nav-title', { hasText: /^AI$/ }).click();
await p.waitForTimeout(400);
await p.locator('.settings-hub-title', { hasText: /^模型$/ }).click();
await p.waitForTimeout(600);
await p.getByRole('button', { name: '添加模型' }).click();
await p.waitForTimeout(400);
await p.locator('.field', { hasText: '别名' }).locator('input').fill('e2e');
const prov = p.locator('.field', { hasText: '服务商' }).locator('select');
if (await prov.count()) await prov.selectOption('openai');
await p.waitForTimeout(200);
const base = p.locator('.field', { hasText: 'API 根地址' }).locator('input');
if (await base.count()) await base.fill(FAKE);
await p.locator('.field', { hasText: '模型名' }).locator('input').fill('fake-vision');
const key = p.locator('.field', { hasText: 'API 密钥' }).locator('input');
if (await key.count()) await key.fill('sk-e2e');
// 能力：必须勾上「图片」，否则 pickVisionModel 不会选它
await p.locator('.chip', { hasText: '图片' }).click();
await p.getByRole('button', { name: '保存' }).first().click();
await p.waitForTimeout(800);

await toLabTrack();

/* ---------------- T1 选图 ---------------- */

const pick = p.locator('.lab-track-pick');
check('T1 选图卡存在', (await pick.count()) === 1);
const pickBtn = p.locator('.lab-track-pickbtn');
const btnBox = await pickBtn.boundingBox();
const btnStyle = await pickBtn.evaluate((el) => {
  const s = getComputedStyle(el);
  return { h: el.getBoundingClientRect().height, bg: s.backgroundColor, pad: s.paddingLeft };
});
check(
  'T1 选图是带样式的按钮（不是裸 file 控件）',
  !!btnBox && btnBox.height >= 28 && btnStyle.pad !== '0px',
  `h=${btnBox?.height} bg=${btnStyle.bg} pad=${btnStyle.pad}`,
);
check('T1 原生 file 输入被隐藏', await p.locator('.lab-track-pick input[type=file]').evaluate((el) => el.hidden));

await p.locator('.lab-track-pick input[type=file]').setInputFiles({
  name: '两步路轨迹.svg',
  mimeType: 'image/svg+xml',
  buffer: Buffer.from(svg),
});
await p.waitForSelector('.lab-track-pick.has-file', { timeout: 8000 });
check('T1 载入后显示文件名与尺寸', (await p.locator('.lab-track-pickname').innerText()).includes('两步路轨迹.svg'));
check('T1 状态栏显示尺寸', /已载入 600×600/.test(await status()), await status());

/* ---------------- T2 提取 ---------------- */

const beforeExtract = await canvasSum();
await p.getByRole('button', { name: '提取轨迹' }).click();
await p.waitForFunction(
  () => /完成：/.test(document.querySelector('.lab-track-status')?.textContent ?? ''),
  null,
  { timeout: 30000 },
);
check('T2 提取完成并给出段数/点数', /(\d+) 段/.test(await status()), await status());
const segText = await p.locator('.lab-track-gaps').innerText();
check('T2 识别到轨迹段', /\d+ 段/.test(segText), segText.replace(/\s+/g, ' '));
const afterExtract = await canvasSum();
check('T2 轨迹真的画到了画布上', afterExtract !== beforeExtract);

/* ---------------- T3 AI 校准 ---------------- */

const beforeAI = await canvasSum();
await p.getByRole('button', { name: 'AI 校准' }).click();
await p.waitForFunction(
  () => /AI 校准完成|AI 校准失败/.test(document.querySelector('.lab-track-status')?.textContent ?? ''),
  null,
  { timeout: 30000 },
);
check('T3 AI 校准成功', /AI 校准完成/.test(await status()), await status());
check('T3 模型收到了图片', visionStats.calls > 0 && visionStats.withImage > 0, JSON.stringify(visionStats));
const diffText = await p.locator('.lab-track-diff').innerText().catch(() => '');
check('T3 显示两条轨迹的偏差', /平均\s*[\d.]+px/.test(diffText) && /长度/.test(diffText), diffText.replace(/\s+/g, ' '));
check('T3 AI 校准记录写进日志', /比例尺|里程/.test(await p.locator('.lab-track-log').first().innerText()));
const afterAI = await canvasSum();
check('T3 AI 虚线画进了画布', afterAI !== beforeAI);

/* ---------------- T4 图层开关 ---------------- */

const layerToggle = (re) => p.locator('.lab-track-layers label').filter({ hasText: re }).locator('input');
const allOn = await canvasSum();
await layerToggle(/^原图/).uncheck();
const noImg = await canvasSum();
check('T4 关掉原图后画布变了', noImg !== allOn);
await layerToggle(/^原图/).check();
check('T4 打开原图恢复', (await canvasSum()) === allOn);

await layerToggle(/^AI 提取的轨迹/).uncheck();
const noAI = await canvasSum();
check('T4 关掉 AI 层后画布变了', noAI !== allOn);
await layerToggle(/^AI 提取的轨迹/).check();
check('T4 AI 层可重新打开', (await canvasSum()) === allOn);

await layerToggle(/^提取的轨迹/).uncheck();
const noAlg = await canvasSum();
check('T4 关掉算法层后画布变了', noAlg !== allOn);
await layerToggle(/^提取的轨迹/).check();

/* ---------------- T5 地图复现 ---------------- */

check('T5 地图已初始化', (await p.locator('.lab-track-map.leaflet-container').count()) === 1);
await p.getByRole('button', { name: '在地图上点起点' }).click();
await p.locator('.lab-track-map').click({ position: { x: 180, y: 150 } });
await p.waitForTimeout(600);
const replay = p.getByRole('button', { name: '▶ 复现' });
check('T5 设好起点后可以复现', await replay.isEnabled());
await replay.click();
await p.waitForTimeout(1200);
const stopped = p.getByRole('button', { name: '⏹ 停止' });
check('T5 复现中按钮变「停止」', await stopped.count());
const prog1 = await p.locator('.lab-track-mapbar .muted.small').innerText();
check('T5 进度在推进', /已走\s*\d+m/.test(prog1), prog1.trim());
await p.waitForTimeout(700);
const prog2 = await p.locator('.lab-track-mapbar .muted.small').innerText();
check('T5 里程继续增加', prog2 !== prog1, `${prog1.trim()} → ${prog2.trim()}`);
if (await stopped.count()) await stopped.click();

/* ---------------- T6 存成本库定位 ---------------- */

await p.locator('.lab-track-name').fill('截图轨迹E2E');
await p.getByRole('button', { name: '保存为定位文件' }).click();
await p.waitForSelector('.toast', { timeout: 8000 }).catch(() => {});
const saveStatus = await status();
check('T6 保存成功并报出点数', /已保存「截图轨迹E2E(\.drloc)?」/.test(saveStatus), saveStatus);

await toLocationFiles();
await p.getByRole('button', { name: '选已有定位文件' }).click();
await p.waitForTimeout(700);
const listText = (await p.locator('.file-list').innerText()).replace(/\s+/g, ' ');
check('T6 文件库里能看见这份定位', listText.includes('截图轨迹E2E'), listText.slice(0, 160));
const row = p.locator('.file-list .file-item').filter({ hasText: '截图轨迹E2E' }).first();
await row.getByRole('button', { name: '打开' }).click();
await p.waitForTimeout(900);
const head = await p.locator('.loc-card-head').filter({ hasText: '个点' }).first().innerText();
check('T6 打开后点数对得上', /(\d+) 个点/.test(head) && Number(/(\d+) 个点/.exec(head)[1]) >= 2, head.replace(/\s+/g, ' '));

console.log(`\n结果：${failures.length === 0 ? '全部通过' : `${failures.length} 项失败`}`);
if (failures.length) console.log(failures.map((f) => ` - ${f}`).join('\n'));

await browser.close();
vision.close();
staticServer.close();
process.exit(failures.length ? 1 : 0);
