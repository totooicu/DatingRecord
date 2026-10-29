import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT || '/usr/local/node/lib/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  await p.goto(process.argv[2] || 'http://localhost:5174/');
  await p.waitForFunction(() => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none');
  if (await p.getByText('载入示例数据看看效果').count()) await p.getByText('载入示例数据看看效果').click();
  const result = await p.evaluate(async () => {
    const r = await import('/src/core/repo/files.ts');
    const db = await import('/src/core/db/index.ts');
    const { getBlob, blobToBase64 } = await import('/src/core/db/blob.ts');
    const { setPrivacyMode } = await import('/src/privacy.ts');
    const { importLibrary } = await import('/src/core/io/import.ts');
    const { mergeRows } = await import('/src/core/sync/mergeRows.ts');
    const { FILE_TOOLS } = await import('/src/core/tools/files.ts');
    const check = (ok, text) => { if (!ok) throw new Error(text); };
    let serial = 0;
    const add = name => r.insertFileRaw({ file: new Blob([`bytes-${++serial}`]), name, storedId: `test-${serial}`, sha256: `hash-${serial}` });
    const [a, b] = await Promise.all([add(' same.JPG '), add('same.JPG')]);
    check(new Set([a.name, b.name]).size === 2, 'parallel names unique');
    check([a.name, b.name].includes('same_2.JPG'), 'suffix preserves extension');
    const c = await add('same_2.JPG');
    check(c.name === 'same_3.JPG', 'numbered suffix continues');
    check((await add('same.jpg')).name === 'same.jpg', 'extension case distinct');
    check((await add('Same.JPG')).name === 'Same.JPG', 'stem case distinct');
    check((await add('same.png')).name === 'same.png', 'extension participates');
    const { uploadFile } = await import('/src/core/files/upload.ts');
    const up1 = await uploadFile(new File(['first content'], 'uploaded.txt'));
    const up2 = await uploadFile(new File(['other content'], 'uploaded.txt'));
    check(up1.kind === 'created' && up2.kind === 'created' && up2.file.name === 'uploaded_2.txt', 'same name different content uploads');
    await add('.hidden');
    check((await add('.hidden')).name === '.hidden_2', 'dotfile suffix');
    check((await add('  ')).name === '未命名', 'empty fallback');
    const freed = await add('freed.txt');
    await r.deleteFile(freed.id);
    check((await add('freed.txt')).name === 'freed.txt', 'deleted name reusable');
    const hidden = await add('private.txt');
    r.setFilePrivate(hidden.id, true);
    setPrivacyMode(true);
    check((await add('private.txt')).name === 'private_2.txt', 'hidden occupies name');
    check(!JSON.stringify(r.fileNameDuplicates()).includes(hidden.id), 'scan hides private');
    const mapping = r.insertMappedFile({ name: 'same.JPG', sourceUrl: 'test:fixture', storedId: 'mapping-test', mime: 'text/plain' });
    check(mapping.name === 'same_4.JPG', 'mapping allocation');
    const before = await (await getBlob(c.id)).text();
    let suggestion;
    try { r.renameFile(c.id, 'same.JPG'); } catch (e) { suggestion = e.suggestion; }
    check(suggestion === 'same_3.JPG', 'rename conflict suggestion');
    check(r.getFile(c.id).name === c.name && await (await getBlob(c.id)).text() === before, 'rejected rename unchanged');
    const lib = { persons: [], attachments: [
      { id: a.id, name: 'overwritten.txt', data: await blobToBase64(new Blob(['WRONG'])) },
      { id: 'import-name-test', name: 'same.JPG', storedId: 'import-ref', data: await blobToBase64(new Blob(['import bytes'])) },
    ] };
    const original = await (await getBlob(a.id)).text();
    const imported = await importLibrary(JSON.stringify(lib), 'merge');
    check(imported.counts.renamedAttachments === 1, 'import reports rename');
    check(await (await getBlob(a.id)).text() === original, 'existing id blob not overwritten');
    const second = await importLibrary(JSON.stringify(lib), 'merge');
    check(second.counts.attachments === 0 && second.skipped === 2, 'import idempotent');
    db.transact(() => mergeRows({ persons: [], attachments: [{ id: 'sync-name-test', name: 'same.JPG', storedId: 'sync-ref' }] }));
    check(r.getFile('sync-name-test').name === 'same_6.JPG', 'sync allocation');
    const legacy1 = await add('legacy.txt');
    const legacy2 = await add('old.txt');
    db.transact(() => db.run('UPDATE attachments SET name = ? WHERE id = ?', [' legacy.txt ', legacy2.id]));
    const group = r.fileNameDuplicates().find(g => g.name === 'legacy.txt');
    check(group?.files.length === 2, 'legacy trim scan');
    const ids = group.files.map(f => f.id);
    const snapshots = await Promise.all(ids.map(async id => ({ file: r.getFile(id), text: await (await getBlob(id)).text() })));
    const changes = r.resolveFileNameDuplicates(group.name, ids);
    check(changes.length === 1 && changes[0].name === 'legacy_2.txt', 'legacy resolve');
    for (const s of snapshots) {
      check(r.getFile(s.file.id).storedId === s.file.storedId, 'reference unchanged');
      check(await (await getBlob(s.file.id)).text() === s.text, 'blob unchanged');
    }
    let stale = false;
    try { r.resolveFileNameDuplicates(group.name, ids); } catch { stale = true; }
    check(stale, 'stale resolution rejected');
    check(FILE_TOOLS.find(t => t.name === 'file.nameDuplicates')?.mutating === false, 'scan tool');
    check(FILE_TOOLS.find(t => t.name === 'file.resolveNameDuplicates')?.mutating === true, 'mutating tool');
    const { createPlaylist, updatePlaylistMeta } = await import('/src/core/music/playlistFile.ts');
    const pl1 = await createPlaylist({ name: 'playlist' });
    const pl2 = await createPlaylist({ name: 'playlist' });
    check(pl2.name === 'playlist_2.drpl', 'playlist common naming');
    const plBefore = await (await getBlob(pl2.id)).text();
    try { await updatePlaylistMeta(pl2.id, { name: 'playlist', description: 'must not persist' }); } catch {}
    check(await (await getBlob(pl2.id)).text() === plBefore, 'playlist rejection before blob write');
    const { createLocation } = await import('/src/core/location/locationFile.ts');
    await createLocation({ name: 'trip' });
    check((await createLocation({ name: 'trip' })).name === 'trip_2.drloc', 'location common naming');
    setPrivacyMode(false);
    const ui = await add('ui-rename.txt');
    const { bump } = await import('/src/store.ts');
    bump();
    return { ui: ui.name, legacy1: legacy1.id, legacy2: legacy2.id };
  });
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.locator('.settings-nav-title', { hasText: /^文件$/ }).click();
  const row = p.locator('.file-item').filter({ has: p.getByRole('button', { name: result.ui, exact: true }) });
  await row.getByRole('button', { name: '改名', exact: true }).click();
  await p.getByRole('textbox', { name: '文件名' }).fill('same.JPG');
  await p.getByRole('textbox', { name: '文件名' }).press('Enter');
  await p.getByRole('alert').waitFor();
  await p.getByRole('button', { name: '使用建议名称' }).click();
  await p.getByRole('button', { name: 'same_7.JPG', exact: true }).waitFor();
  await p.evaluate(async ({ legacy1, legacy2 }) => {
    const db = await import('/src/core/db/index.ts');
    db.transact(() => db.run('UPDATE attachments SET name = ? WHERE id IN (?, ?)', ['legacy.txt', legacy1, legacy2]));
    (await import('/src/store.ts')).bump();
  }, result);
  await p.getByRole('tab', { name: /^整理/ }).click();
  await p.getByRole('button', { name: '扫描同名文件' }).click();
  for (const [width, height] of [[390, 844], [820, 1180], [1440, 900]]) {
    await p.setViewportSize({ width, height });
    assert(await p.getByRole('button', { name: '编号整理', exact: true }).isVisible());
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  p.on('dialog', d => d.accept());
  await p.getByRole('button', { name: '编号整理', exact: true }).click();
  await p.getByText('已编号 1 个文件', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: naming, case, concurrent inserts, privacy, mapping, import idempotency/blob safety, sync, legacy cleanup, playlist/location, tools, rename suggestion and three viewports');
} finally { await browser.close(); }
