// Uses a fresh browser database and a Vite dev server (default :5174).
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT || '/usr/local/node/lib/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto(process.argv[2] || 'http://localhost:5174/');
  await p.waitForFunction(() => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none');
  if (await p.getByText('载入示例数据看看效果').count()) await p.getByText('载入示例数据看看效果').click();
  await p.locator('.tabbar-item', { hasText: '设置' }).click();
  await p.locator('.settings-nav-title', { hasText: /^文件$/ }).click();
  const evidence = await p.evaluate(async () => {
    const db = await import('/src/core/db/index.ts');
    const { insertFileRaw, getFile, getBlob } = await import('/src/core/repo/files.ts');
    const { planCompactNames, applyCompactNames } = await import('/src/core/files/compact.ts');
    const { bump } = await import('/src/store.ts');
    const a = `sha-${'a'.repeat(32)}`, b = `sha-${'b'.repeat(32)}`, c = `sha-${'c'.repeat(32)}`;
    const old = [a, `${a}_3`, `${a}_4`, `${b}_3`, `${b}_4`, c, `${c}_1`, `${c}_2`];
    const files = [];
    for (let i = 0; i < old.length; i++) files.push(await insertFileRaw({ file: new File([`payload-${i}`], `test-${i}.txt`), storedId: old[i] + '.txt', name: `test-${i}.txt`, sha256: '' }));
    const original = old.map((s, i) => `[label-${i}](file:${s}.txt)`).join(' ');
    db.run("INSERT INTO events(id,title,content,media_json,deleted_at) VALUES(?,?,?,?,?)", ['compact-event', 'deleted fixture', original, JSON.stringify(old.map(s => s + '.txt')), '2026-01-01']);
    db.run("INSERT INTO persons(id,display_name,avatar,icon_json) VALUES(?,?,?,?)", ['compact-person','fixture', `file:${b}_3.txt`, JSON.stringify({ fileId: `${b}_4.txt` })]);
    db.run("INSERT INTO event_messages(id,event_id,order_key,body) VALUES(?,?,?,?)", ['compact-msg','compact-event','a',original]);
    const plan = planCompactNames();
    const before = files.map(f => getFile(f.id).storedId);
    // Stale plan must fail without changing metadata.
    db.run('UPDATE attachments SET name = ? WHERE id = ?', ['changed', files[1].id]);
    let stale = false;
    try { applyCompactNames(plan); } catch { stale = true; }
    db.run('UPDATE attachments SET name = ? WHERE id = ?', [files[1].name, files[1].id]);
    // Malformed reference JSON must roll back even the temporary names.
    db.run("UPDATE persons SET icon_json = ? WHERE id = ?", ['invalid-json','compact-person']);
    let rolledBack = false;
    try { applyCompactNames(plan); } catch { rolledBack = JSON.stringify(before) === JSON.stringify(files.map(f => getFile(f.id).storedId)); }
    db.run("UPDATE persons SET icon_json = ? WHERE id = ?", [JSON.stringify({ fileId: `${b}_4.txt` }),'compact-person']);
    window.compactFixture = { files, original, old };
    bump();
    return { stale, rolledBack, count: plan.length, before, blobs: await Promise.all(files.map(async f => (await getBlob(f.id)).text())) };
  });
  assert.equal(evidence.stale, true);
  assert.equal(evidence.rolledBack, true);
  assert.equal(evidence.count, 6);
  const panel = p.locator('.compact-names');
  await p.getByRole('tab', { name: /^整理/ }).click();
  await panel.getByRole('button', { name: '预览紧密编号' }).click();
  assert.equal(await panel.locator('.dup-group').count(), 6);
  await panel.getByRole('button', { name: '确认紧密编号' }).click();
  await panel.getByRole('status').waitFor();
  const result = await p.evaluate(async () => {
    const { files } = window.compactFixture;
    const { getFile, getBlob } = await import('/src/core/repo/files.ts');
    const { queryOne } = await import('/src/core/db/index.ts');
    const { planCompactNames } = await import('/src/core/files/compact.ts');
    return {
      names: files.map(f => getFile(f.id).storedId),
      blobs: await Promise.all(files.map(async f => (await getBlob(f.id)).text())),
      remaining: planCompactNames().length,
      event: queryOne("SELECT content, media_json FROM events WHERE id='compact-event'"),
      message: queryOne("SELECT body FROM event_messages WHERE id='compact-msg'").body,
      person: queryOne("SELECT avatar, icon_json FROM persons WHERE id='compact-person'"),
    };
  });
  const stem = x => `sha-${x.repeat(32)}`;
  const expected = [stem('a'), `${stem('a')}_2`, `${stem('a')}_3`, stem('b'), `${stem('b')}_2`, stem('c'), `${stem('c')}_2`, `${stem('c')}_3`].map(x => x + '.txt');
  assert.deepEqual(result.names, expected);
  assert.deepEqual(result.blobs, evidence.blobs);
  assert.equal(result.remaining, 0);
  const md = expected.map((s,i) => `[label-${i}](file:${s})`).join(' ');
  assert.equal(result.event.content, md);
  assert.equal(result.message, md);
  assert.deepEqual(JSON.parse(result.event.media_json), expected);
  assert.equal(result.person.avatar, `file:${expected[3]}`);
  assert.equal(JSON.parse(result.person.icon_json).fileId, expected[4]);
  console.log('PASS: preview, X missing, gaps, _1 shift, non-cascading references, deleted records, blobs unchanged, stale rejection, rollback and idempotency');
} finally { await browser.close(); }
