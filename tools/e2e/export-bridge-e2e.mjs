// 导出/下载落盘通道的端到端回归：壳里走桥写文件，浏览器里走 <a download>。
//
// 要证的事：
//   E1 浏览器（无壳）：导出备份仍然弹出下载，文件名带 .drp.zip
//   E2 有壳：点了导出不再有 download 事件，改由 file.writePublic 收字节
//   E3 能力只探一次：一次导出只发一条 file.capabilities
//   E4 分片续写：5MB 的数据被切成多片，首片不带 uri、后续带 uri + append:true，
//      假壳拼回来的字节与原数据逐字节一致（sha256 相同）
//   E5 有壳但写失败：不回退 <a download>（壳里那条路本来就没反应），错误冒到界面
//   E6 附件下载 downloadFile 走同一条通道，文件名/MIME 一起交过去
//   E7 壳太旧（会回话，但回的是「unknown action: file.capabilities」）：
//      既不谎称「已开始下载」，也不静默——必须把「这版壳存不了」说出来
//
// 假壳用 addInitScript 装，和 nutstore-bridge-e2e 同一套做法：
// 接 gv-bridge-request，把 file.capabilities / file.writePublic 记下来再回包。
//
// 反证（证明 E7 不是摆设）：把 save.ts 里 `if (c.answered) throw` 那三行删掉，
// 旧壳这一路立刻退回 anchorDownload + 「已开始下载」，E7 的
// 「错误说清是壳的问题」「没有退回 <a download>」「页面上不出现『已开始下载』」三条当场变红。
//
// 用法：node tools/e2e/export-bridge-e2e.mjs [dev-url]   默认 http://localhost:5174/
// 必须 Vite dev 服务（要动态 import 源码模块直接调 saveBytes）。

import crypto from 'node:crypto';

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const APP = process.argv[2] || 'http://localhost:5174/';

const failures = [];
const check = (label, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
    failures.push(label);
  }
};

/** 假壳：接 file.capabilities / file.writePublic，把收到的分片按 uri 拼回字节 */
function fakeShell({ failWrite = false, oldShell = false, maxChunkBytes = 4 * 1024 * 1024 } = {}) {
  const state = { caps: 0, writes: [], answered: 0, files: new Map() };
  const send = (id, ok, result, error) => {
    window.postMessage({ type: 'gv-bridge-response', id, ok, result, error }, '*');
  };
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.type !== 'gv-bridge-request') return;
    const params = m.params || {};
    if (oldShell) {
      // file.writePublic v2 之前的壳：ping 认，其它一律照真实 JsBridge 的回法
      // 回一句「unknown action: …」——**它会回话**，这是它和「根本没有壳」唯一的区别。
      state.answered += 1;
      if (m.action === 'ping') {
        send(m.id, true, { pong: true, engine: 'webview' });
        return;
      }
      send(m.id, false, null, `unknown action: ${m.action}`);
      return;
    }
    if (m.action === 'file.capabilities') {
      state.caps += 1;
      send(m.id, true, { version: 2, binary: true, encodings: ['utf8', 'base64'], append: true, maxChunkBytes, downloads: 'MediaStore' });
      return;
    }
    if (m.action === 'file.writePublic') {
      state.writes.push({
        name: params.name,
        mime: params.mime,
        encoding: params.encoding,
        append: params.append === true,
        uri: params.uri || '',
        len: (params.content || '').length,
      });
      if (failWrite) {
        send(m.id, false, null, '模拟写盘失败：磁盘已满');
        return;
      }
      const uri = params.uri || `content://downloads/假壳/${state.writes.length}`;
      const bin = Uint8Array.from(atob(params.content || ''), (c) => c.charCodeAt(0));
      const prev = state.files.get(uri) ?? new Uint8Array(0);
      const next = new Uint8Array(prev.length + bin.length);
      next.set(prev);
      next.set(bin, prev.length);
      state.files.set(uri, next);
      send(m.id, true, { uri, name: params.name, location: 'Downloads', bytes: bin.length });
      return;
    }
    if (m.action === 'ping') {
      send(m.id, true, { pong: true });
      return;
    }
  });
  window.__fakeShell = state;
}

const hex = (u8) => crypto.createHash('sha256').update(Buffer.from(u8)).digest('hex');

const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });

async function page(withShell, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, acceptDownloads: true });
  if (withShell) await ctx.addInitScript(fakeShell, opts);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await p.goto(APP, { waitUntil: 'load' });
  await p.waitForFunction(() => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none', null, { timeout: 90000 });
  if (await p.getByText('载入示例数据看看效果').count()) {
    await p.getByText('载入示例数据看看效果').click();
    await p.waitForTimeout(3000);
  }
  return { ctx, p };
}

// ---------- E1 浏览器：仍然弹下载 ----------
{
  console.log('\nE1 浏览器（没有壳）里导出备份，照样弹下载');
  const { ctx, p } = await page(false);
  const dl = p.waitForEvent('download', { timeout: 20000 });
  await p.evaluate(async () => {
    const { exportArchiveToFile } = await import('/src/core/io/archive.ts');
    await exportArchiveToFile({ includeAttachments: false });
  });
  const d = await dl.catch(() => null);
  check('触发了浏览器下载', !!d, d ? '' : '没等到 download 事件');
  check('文件名是 .drp.zip', (d?.suggestedFilename() || '').endsWith('.drp.zip'), d?.suggestedFilename());
  await ctx.close();
}

// ---------- E2/E3 有壳：走桥，且能力只问一次 ----------
{
  console.log('\nE2/E3 有壳时导出备份：不再弹下载，字节交给 file.writePublic');
  const { ctx, p } = await page(true);
  let downloads = 0;
  p.on('download', () => (downloads += 1));
  await p.evaluate(async () => {
    const { exportArchiveToFile } = await import('/src/core/io/archive.ts');
    await exportArchiveToFile({ includeAttachments: false });
  });
  await p.waitForTimeout(400);
  const st = await p.evaluate(() => ({ caps: window.__fakeShell.caps, writes: window.__fakeShell.writes }));
  check('没有触发浏览器下载', downloads === 0, `downloads=${downloads}`);
  check('发了一次 file.capabilities', st.caps === 1, `caps=${st.caps}`);
  check('至少写了一次 file.writePublic', st.writes.length >= 1, JSON.stringify(st.writes).slice(0, 200));
  const w0 = st.writes[0] ?? {};
  check('首片带 name/mime/encoding=base64', /\.drp\.zip$/.test(w0.name ?? '') && w0.mime === 'application/zip' && w0.encoding === 'base64', JSON.stringify(w0));
  check('首片不带 uri、append 为 false', !w0.uri && w0.append === false, JSON.stringify(w0));

  // 再导一次：能力不该再问第二遍
  await p.evaluate(async () => {
    const { exportArchiveToFile } = await import('/src/core/io/archive.ts');
    await exportArchiveToFile({ includeAttachments: false });
  });
  await p.waitForTimeout(300);
  const caps2 = await p.evaluate(() => window.__fakeShell.caps);
  check('第二次导出不再重新探测能力', caps2 === 1, `caps=${caps2}`);
  await ctx.close();
}

// ---------- E4 分片续写：5MB 原样拼回 ----------
{
  console.log('\nE4 5MB 数据分片过桥，拼回来一个字节都不差');
  const { ctx, p } = await page(true);
  const res = await p.evaluate(async () => {
    const { saveBytes } = await import('/src/core/io/save.ts');
    const bytes = new Uint8Array(5 * 1024 * 1024 + 12345);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31 + 7) & 0xff;
    await saveBytes(bytes, 'big.bin', 'application/octet-stream');
    const files = [...window.__fakeShell.files.values()];
    const got = files[0] ?? new Uint8Array(0);
    // 逐字节比对放页面里做，省得把 5MB 传回来
    let same = got.length === bytes.length;
    if (same) for (let i = 0; i < bytes.length; i += 1) if (got[i] !== bytes[i]) { same = false; break; }
    return { pieces: window.__fakeShell.writes.length, same, total: got.length, want: bytes.length, appends: window.__fakeShell.writes.map((w) => w.append), uris: window.__fakeShell.writes.map((w) => !!w.uri) };
  });
  check('被切成了多片', res.pieces >= 3, `pieces=${res.pieces}`);
  check('首片不 append、后续都 append', res.appends[0] === false && res.appends.slice(1).every(Boolean), JSON.stringify(res.appends));
  check('后续片都带 uri', res.uris[0] === false && res.uris.slice(1).every(Boolean), JSON.stringify(res.uris));
  check('拼回来的长度一致', res.total === res.want, `${res.total} vs ${res.want}`);
  check('逐字节一致', res.same === true);
  await ctx.close();
}

// ---------- E5 写失败：不回退 <a download>，错误可见 ----------
{
  console.log('\nE5 壳里写盘失败：不许偷偷回退成 <a download>，要把错误说出来');
  const { ctx, p } = await page(true, { failWrite: true });
  let downloads = 0;
  p.on('download', () => (downloads += 1));
  const err = await p.evaluate(async () => {
    const { saveBytes } = await import('/src/core/io/save.ts');
    try {
      await saveBytes(new Uint8Array([1, 2, 3]), 'x.bin', 'application/octet-stream');
      return null;
    } catch (e) {
      return String(e && e.message ? e.message : e);
    }
  });
  await p.waitForTimeout(300);
  check('把壳的错误抛了出来', /磁盘已满/.test(err ?? ''), err ?? 'null');
  check('没有偷偷变成浏览器下载', downloads === 0, `downloads=${downloads}`);
  await ctx.close();
}

// ---------- E6 附件下载走同一条通道 ----------
{
  console.log('\nE6 附件「下载」走同一条通道，名字/MIME 一起带过去');
  const { ctx, p } = await page(true);
  const r = await p.evaluate(async () => {
    const { downloadFile } = await import('/src/core/repo/files.ts');
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    await downloadFile(url, '照片备份.zip', 'application/zip');
    return { writes: window.__fakeShell.writes, files: [...window.__fakeShell.files.values()].map((f) => f.length) };
  });
  const w = r.writes[0] ?? {};
  check('走了 file.writePublic', r.writes.length === 1, JSON.stringify(r.writes).slice(0, 200));
  check('文件名原样带过去', w.name === '照片备份.zip', w.name);
  check('MIME 带过去了', w.mime === 'application/zip', w.mime);
  check('字节数对上（9 字节）', r.files[0] === 9, String(r.files[0]));
  await ctx.close();
}

// ---------- E7 壳太旧（会回话，但不认识 file.capabilities）：不许谎称「已开始下载」 ----------
{
  console.log('\nE7 旧壳（回了「unknown action: file.capabilities」）：既不假装下载，也不静默');
  const { ctx, p } = await page(true, { oldShell: true });
  let downloads = 0;
  p.on('download', () => (downloads += 1));
  const err = await p.evaluate(async () => {
    const { saveBytes } = await import('/src/core/io/save.ts');
    try {
      await saveBytes(new Uint8Array([1, 2, 3]), 'old.bin', 'application/octet-stream');
      return null;
    } catch (e) {
      return String(e && e.message ? e.message : e);
    }
  });
  await p.waitForTimeout(400);
  const st = await p.evaluate(() => ({
    answered: window.__fakeShell.answered,
    writes: window.__fakeShell.writes.length,
    lied: document.body.innerText.includes('已开始下载'),
  }));
  check('壳真的回了话（不是等超时）', st.answered >= 1, `answered=${st.answered}`);
  check('没写成任何文件', st.writes === 0, `writes=${st.writes}`);
  check('错误说清是壳的问题', /壳/.test(err ?? '') && /更新|v2/.test(err ?? ''), err ?? 'null');
  check('没有退回 <a download>（旧壳里那条路是死的）', downloads === 0, `downloads=${downloads}`);
  check('页面上不出现「已开始下载」', st.lied === false);
  await ctx.close();
}

await b.close();
console.log(failures.length ? `\n失败 ${failures.length} 项` : '\n全部通过 ✓');
process.exit(failures.length ? 1 : 0);
