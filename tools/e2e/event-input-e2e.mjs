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
  console.log('PASS strict time parser, invalid date, range checks, current-time button and save');
} finally { await browser.close(); }
