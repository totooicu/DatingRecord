import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT || '/usr/local/node/lib/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  await p.goto(process.argv[2] || 'http://localhost:4173/');
  await p.waitForFunction(() => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none');
  if (await p.getByText('载入示例数据看看效果').count()) await p.getByText('载入示例数据看看效果').click();
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.locator('.settings-nav-title', { hasText: /^文件$/ }).click();
  const bytes = Buffer.from('broken image fixture');
  await p.locator('input[type=file]').first().setInputFiles([
    { name: 'broken.png', mimeType: 'image/png', buffer: bytes },
    { name: 'missing.txt', mimeType: 'text/plain', buffer: Buffer.from('missing fixture') },
    { name: 'unsupported.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('unknown fixture') },
  ]);
  await p.locator('.file-list').getByText('unsupported.bin', { exact: true }).waitFor();
  const snapshot = async (remove = false) => p.evaluate(async (remove) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('dating-record', 3); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const read = db.transaction('blobs', 'readonly');
    const blobs = await new Promise(resolve => { const r = read.objectStore('blobs').getAll(); r.onsuccess = () => resolve(r.result); });
    const keys = await new Promise(resolve => { const r = db.transaction('blobs').objectStore('blobs').getAllKeys(); r.onsuccess = () => resolve(r.result); });
    if (remove) {
      const index = (await Promise.all(blobs.map(b => b.text()))).indexOf('missing fixture');
      if (index < 0) throw new Error('missing fixture not found');
      const t = db.transaction('blobs', 'readwrite'); t.objectStore('blobs').delete(keys[index]);
      await new Promise(resolve => t.oncomplete = resolve);
    }
    db.close();
    return keys.length;
  }, remove);
  await snapshot(true);
  const count = await snapshot();
  const rows = await p.locator('.file-item').count();
  const panel = p.locator('.file-health');
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: '开始扫描' }).click();
  await panel.getByRole('button', { name: '开始扫描' }).waitFor();
  await p.waitForFunction(() => !document.querySelector('.file-health button').disabled, null, { timeout: 120000 });
  assert.match(await panel.innerText(), /broken.png/);
  assert.match(await panel.innerText(), /missing.txt/);
  assert.match(await panel.innerText(), new RegExp(createHash('sha256').update(bytes).digest('hex')));
  assert.match(await panel.innerText(), /20 字节/);
  await panel.locator('select').selectOption('missing');
  assert.equal(await panel.locator('.dup-group').count(), 1);
  assert.match(await panel.locator('.dup-group').innerText(), /missing.txt/);
  await panel.locator('select').selectOption('unknown');
  assert.match(await panel.innerText(), /unsupported.bin/);
  assert.equal(await snapshot(), count);
  assert.equal(await p.locator('.file-item').count(), rows);
  assert.deepEqual(errors, []);
  console.log('PASS: missing content, decode failure, unsupported format, hash/size, filtering and read-only scan');
} finally { await browser.close(); }
