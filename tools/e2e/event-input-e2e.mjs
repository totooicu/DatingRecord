// Vite dev server required. Uses isolated browser storage, global Playwright and Chromium.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT || '/usr/local/node/lib/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] || 'http://localhost:5174/');
  await page.waitForFunction(() => document.querySelector('.app, .welcome'));
  const checks = await page.evaluate(async () => {
    const { parseTimeText, timeText } = await import('/src/ui/event/timeText.ts');
    const { initialDraft, validateDraftTime, draftToPayload } = await import('/src/ui/event/draft.ts');
    const d = initialDraft(undefined, undefined, undefined, []);
    d.start = '2026-10-28 21:30';
    const valid = !Object.keys(validateDraftTime(d)).length && !!draftToPayload(d).time.start;
    d.timeKind = 'interval'; d.end = '2026-10-27 21:30';
    const reverse = !!validateDraftTime(d).end;
    const results = [valid, reverse, parseTimeText('2026-02-30 12:00') === null,
      parseTimeText('2026/10/28 12:00') === null, parseTimeText('2026-10-28T12:00') === null,
      parseTimeText('2026-10-28 24:00') === null, !!parseTimeText('2024-02-29 12:00'),
      !!parseTimeText(timeText(new Date().toISOString()))];
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { EventForm } = await import('/src/ui/event/EventForm.tsx');
    const host = document.createElement('div'); document.body.append(host);
    ReactDOM.createRoot(host).render(React.createElement(EventForm, { onClose() {} }));
    return results;
  });
  assert(checks.every(Boolean));
  const start = page.getByLabel('开始时间', { exact: true });
  await page.getByRole('button', { name: '获取当前时间', exact: true }).click();
  assert.match(await start.inputValue(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  await start.fill('2026-02-30 12:00');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal(await start.getAttribute('aria-invalid'), 'true');
  assert(await page.getByRole('alert').count());
  await start.fill('2026-10-28 21:30');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const count = await page.evaluate(async () => (await import('/src/core/repo/events/index.ts')).listEvents().length);
  assert.equal(count, 1);
  await page.getByLabel('地点文本').fill('手填地址');
  await page.getByRole('button', { name: '地图选点', exact: true }).click();
  await page.locator('.place-map').click({ position: { x: 150, y: 120 } });
  await page.getByRole('button', { name: '确认选点', exact: true }).click();
  assert.equal(await page.getByLabel('地点文本').inputValue(), '手填地址');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const place = await page.evaluate(async () => {
    const repo = await import('/src/core/repo/events/index.ts');
    const { initialDraft, draftToPayload } = await import('/src/ui/event/draft.ts');
    const event = repo.listEvents()[0];
    const draft = initialDraft(event, undefined, undefined, []);
    return { saved: event.place, again: draftToPayload(draft).place };
  });
  assert.equal(place.saved.name, '手填地址');
  assert.equal(typeof place.saved.geo.lat, 'number');
  assert.deepEqual(JSON.parse(JSON.stringify(place.again)), place.saved);
  await page.getByRole('button', { name: '地图选点', exact: true }).click();
  await page.getByRole('button', { name: '取消选点', exact: true }).click();
  assert.equal(await page.getByLabel('地点文本').inputValue(), '手填地址');
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  console.log('PASS time and place input: text, map selection, cancellation, roundtrip and layouts');
} finally { await browser.close(); }
