// Vite dev required; isolated browser storage, global Playwright + Chromium.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT || '/usr/local/node/lib/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.argv[2] || 'http://localhost:5174/');
  await page.waitForFunction(() => document.querySelector('.app, .welcome'));
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { insertFileRaw } = await import('/src/core/repo/files.ts');
    const { PreviewModal } = await import('/src/ui/preview/PreviewModal.tsx');
    const doc = { format: 'dr.location', version: 1, name: '预览测试', offset: { lat: .01, lng: .02 }, offsets: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), points: Array.from({ length: 250 }, (_, i) => ({ lat: 31 + i * .001, lng: 121, ts: new Date(1700000000000 + i * 1000).toISOString(), note: `点${i}` })) };
    const blob = new Blob([JSON.stringify(doc)], { type: 'application/x-dr-location' });
    const file = await insertFileRaw({ file: blob, name: '预览测试.drloc', storedId: 'test-preview.drloc', sha256: '' });
    window.testPreview = { id: file.id, content: await blob.text() };
    const host = document.createElement('div'); document.body.append(host);
    ReactDOM.createRoot(host).render(React.createElement(PreviewModal, { file, onClose() {} }));
  });
  await page.waitForSelector('.location-preview-map canvas');
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const list = page.locator('.location-preview-list');
    assert(await list.evaluate(el => { el.scrollTop = 100; return el.scrollHeight > el.clientHeight && el.scrollTop > 0; }));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.getByRole('button', { name: '下一点', exact: true }).click();
  assert.equal(await page.locator('.location-preview-map').getAttribute('data-selected'), '1');
  await page.getByRole('button', { name: '下一页点位' }).click();
  assert.equal(await page.locator('.location-preview-map').getAttribute('data-selected'), '100');
  await page.getByLabel('定位点跳转').fill('249');
  assert.equal(await page.locator('.location-preview-list li').count(), 50);
  assert(await page.getByRole('button', { name: '下一点', exact: true }).isDisabled());
  assert(await page.evaluate(async () => {
    const { getBlob } = await import('/src/core/repo/files.ts');
    return await (await getBlob(window.testPreview.id)).text() === window.testPreview.content;
  }));
  assert.deepEqual(errors, []);
  console.log('PASS preview scroll, map, navigation, paging, read-only and three viewports');
} finally { await browser.close(); }
