// Browser regression; requires Vite dev server, not a production preview.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT || '/usr/local/node/lib/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] || 'http://localhost:5174/');
  const results = await page.evaluate(async () => {
    const { segmentSpeeds, metersBetween } = await import('/src/core/location/format.ts');
    const { speedLines, speedColors, speedBucket } = await import('/src/ui/panel/locationPaint.ts');
    const p = (lng, seconds) => ({ lat: 0, lng, ts: new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString() });
    const points = [p(0, 0), p(0.001, 100), p(0, 130), p(0.002, 200)];
    const original = JSON.stringify(points);
    const speeds = segmentSpeeds(points);
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    const expected = (metersBetween(points[0], points[1]) + metersBetween(points[1], points[2])) / 130 * 3.6;
    const lines = speedLines(points, '#cc3366');
    const color = speedColors('#cc3366').ramp[speedBucket(expected)];
    return {
      empty: segmentSpeeds([]).length === 0,
      single: segmentSpeeds([points[0]]).length === 0,
      first: near(speeds[0], metersBetween(points[0], points[1]) / 100 * 3.6),
      window: near(speeds[1], expected) && expected > 0,
      sliding: near(speeds[2], (metersBetween(points[1], points[2]) + metersBetween(points[2], points[3])) / 100 * 3.6),
      stationary: segmentSpeeds([p(0, 0), p(0, 1), p(0, 2)])[1] === 0,
      equalTime: segmentSpeeds([p(0, 0), p(1, 0), p(2, 2)])[1] === null,
      reversed: segmentSpeeds([p(0, 0), p(1, 3), p(2, 2)])[1] === null,
      invalid: segmentSpeeds([points[0], { ...points[1], ts: 'bad' }, points[2]])[1] === null,
      color: lines.some(l => l.color === color && l.parts.some(part => part.some((v, i) => i > 0 && part[i - 1][1] === 0.001 && v[1] === 0))),
      unchanged: JSON.stringify(points) === original,
    };
  });
  for (const [name, passed] of Object.entries(results)) assert.equal(passed, true, name);
  console.log(`PASS ${Object.keys(results).length} speed and coloring assertions`);
} finally {
  await browser.close();
}
