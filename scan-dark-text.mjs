// 深色模式字体可读性扫描：遍历各主页面，揪出落在深色背景上、computed color 却很暗（看不清）的元素。
import fs from 'node:fs';
import { chromium } from '/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs';

const APP = process.argv[2] || 'http://localhost:4177/';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

const waitBoot = async () => {
  await p.waitForFunction(() => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none', null, { timeout: 90000 });
};
const toSettingsRoot = async () => {
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.waitForTimeout(400);
  for (let i = 0; i < 4; i += 1) {
    if (await p.locator('.settings-nav-title').first().isVisible().catch(() => false)) return;
    const back = p.locator('.back-btn').first();
    if (!(await back.count())) return;
    await back.click();
    await p.waitForTimeout(250);
  }
};

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(2500);
}

// 切深色
await toSettingsRoot();
await p.locator('.settings-nav-title', { hasText: /^外观$/ }).click();
await p.waitForTimeout(500);
await p.getByRole('button', { name: '深色' }).click();
await p.waitForTimeout(500);
console.log('data-mode =', await p.evaluate(() => document.documentElement.dataset.mode));

// 扫描核心：遍历各 tab
const TABS = ['事件', '统计', '记录', '设置'];
const agg = {};
const scanCurrent = async (where) => {
  const res = await p.evaluate(() => {
    const lum = (rgb) => {
      const m = rgb.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
      if (!m) return 255;
      return 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3];
    };
    const effBg = (el) => {
      let e = el;
      while (e && e.nodeType === 1) {
        const bg = getComputedStyle(e).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
        e = e.parentElement;
      }
      return 'rgb(0,0,0)';
    };
    const out = {};
    for (const el of document.querySelectorAll('*')) {
      const txt = (el.innerText || '').trim();
      if (!txt || txt.length > 50) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
      const fl = lum(cs.color);
      if (fl > 170) continue; // 只关心暗/中灰字
      const bl = lum(effBg(el));
      if (bl >= 110) continue; // 背景必须是暗的
      if ((bl + 0.05) / (fl + 0.05) >= 4.5) continue; // WCAG AA 够就放过
      const key = el.className && typeof el.className === 'string'
        ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.')
        : el.tagName.toLowerCase();
      const rec = out[key] = out[key] || { n: 0, color: cs.color, bg: effBg(el), samples: [] };
      rec.n++;
      if (rec.samples.length < 2) rec.samples.push(txt.slice(0, 18));
    }
    return out;
  });
  for (const [k, v] of Object.entries(res)) {
    if (!agg[k]) agg[k] = { n: 0, color: v.color, bg: v.bg, samples: [], where: new Set() };
    agg[k].n += v.n;
    agg[k].color = v.color;
    agg[k].bg = v.bg;
    v.samples.forEach((s) => { if (agg[k].samples.length < 3) agg[k].samples.push(s); });
    agg[k].where.add(where);
  }
};

for (const tab of TABS) {
  await p.locator('.tabbar-item', { hasText: tab }).click().catch(() => {});
  await p.waitForTimeout(700);
  await scanCurrent(tab);
}
// 设置内各页也扫一下
await toSettingsRoot();
await p.waitForTimeout(400);
for (const title of ['外观', '数据', '关于', '隐私']) {
  const loc = p.locator('.settings-nav-title', { hasText: title }).first();
  if (await loc.count()) { await loc.click().catch(() => {}); await p.waitForTimeout(500); await scanCurrent('设置/' + title); }
}
// 进一个事件详情（markdown 渲染区最可能写死黑字）
await p.locator('.tabbar-item', { hasText: '事件' }).click().catch(() => {});
await p.waitForTimeout(700);
const card = p.locator('.event-card, .event-item, [class*="event"]').first();
if (await card.count()) { await card.click().catch(() => {}); await p.waitForTimeout(800); await scanCurrent('事件详情'); }

console.log('\n=== 深色模式下「暗字+暗底（对比度<3）」聚合 ===');
const entries = Object.entries(agg).sort((a, b) => b[1].n - a[1].n);
for (const [k, v] of entries) {
  console.log(`\n[${v.n}x] ${k}   color=${v.color}  bg=${v.bg}  出现在: ${[...v.where].join('、')}`);
  console.log(`      样本: ${v.samples.map((s) => `"${s}"`).join('  ')}`);
}
console.log('\n总计问题选择器:', entries.length);
await browser.close();
