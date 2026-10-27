/*
 * 实验台 e2e：先 node ai-sandbox/build-lab.mjs，再 node ai-sandbox/lab-e2e.mjs
 *
 * 用 file:// 打开 lab.html，通过 window.__sb 钩子驱动打包/预览/执行/回退/放弃，
 * 并核对 <body data-*> 诊断属性。Playwright 路径可用环境变量 PLAYWRIGHT 覆盖。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT || '/usr/local/node/lib/node_modules/playwright/index.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = pathToFileURL(join(HERE, 'lab.html')).href;
if (!existsSync(join(HERE, 'lab.html'))) { console.error('先跑 node ai-sandbox/build-lab.mjs 生成 lab.html'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' 期望 ' + JSON.stringify(b) + ' 实得 ' + JSON.stringify(a));

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL);
await page.waitForFunction(() => !!window.__sb && !!window.__sb.sandbox);

const D = () => page.evaluate(() => ({ ...document.body.dataset }));
const toast = () => page.evaluate(() => document.getElementById('toast').textContent);
const run = (fn, arg) => page.evaluate(fn, arg);

/* 1. 首屏 */
let d = await D();
ok(d.stateHash && d.stateHash !== 'undefined', '首屏 stateHash 有值');
eq(d.sbVersion, '0', '首屏版本 #0（种子）');
eq(d.journal, '0:seed', '流水里有种子版本');
eq(errors, [], '首屏无 JS 报错');

/* 2. 正常批次：打包 → 预览 → 执行 */
await run(() => { window.__sb.pick(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']); window.__sb.pack(); }, null);
await run(() => window.__sb.preview(), null);
d = await D();
eq(d.sbDraft, '6', '草稿 6 条');
eq(d.pvProblems, '0', '正常批次 0 拦截');
ok(Number(d.pvChanged) > 0, '正常批次有改动：' + d.pvChanged);
eq(d.pvSkipped, '0', '正常批次 0 跳过');
const hashBefore = d.stateHash;
await run(() => window.__sb.execute(), null);
d = await D();
ok(d.stateHash !== hashBefore, '执行后状态哈希变了');
eq(d.sbVersion, '1', '执行后版本 #1');
eq(d.sbDraft, '0', '执行后草稿清空');
ok(/已执行，生成 #1/.test(await toast()), '执行 toast：' + await toast());
eq(d.sinkCount, '0', '无副作用批次不外发');

/* 3. 回退 */
await run(() => window.__sb.revertOne(), null);
d = await D();
eq(d.sbVersion, '2', '回退新增版本 #2');
ok(/:revert$/.test(d.journal), '流水尾部是 revert：' + d.journal);
eq(d.stateHash, hashBefore, '回退后状态回到执行前');

/* 4. 放弃草稿 */
await run(() => { window.__sb.pick(['p1', 'x1']); window.__sb.pack(); }, null);
await run(() => window.__sb.discard(), null);
d = await D();
eq(d.sbDraft, '0', '放弃后草稿清空');
eq(d.sbActive, '', '放弃后无活动批次');
ok(/已放弃这批草稿/.test(await toast()), '放弃 toast：' + await toast());

/* 5. 危险批次 · 原子模式：第一条坏的就把整批卡住 */
await run(() => { window.__sb.pick(['p1', 'x6', 'x8']); window.__sb.pack(); window.__sb.preview(); }, null);
const atom = await run(() => {
  const r = window.__sb.last();
  return { ok: r.ok, codes: r.problems.map((p) => p.code), failed: r.failed.length, applied: r.applied, skipped: r.skipped, aborted: r.aborted };
}, null);
eq(atom.ok, false, '原子：危险批次不放行');
eq(atom.failed, 0, '原子：不重复计 failed');
eq(atom.codes.length, 1, '原子：停在第一条问题（' + atom.codes.join(',') + '）');
eq(atom.applied, 1, '原子：中止前算过 1 条，但整批不落');
eq(await run(() => JSON.stringify(window.__sb.last().result) === JSON.stringify(window.__sb.state()), null), true, '原子：预览结果就是原状态（不给你看半截世界）');
const hashPre = (await D()).stateHash;
await run(() => window.__sb.execute(), null);
ok(/执行被拒/.test(await toast()), '原子被拒 toast：' + await toast());
eq((await D()).stateHash, hashPre, '被拒批次没有改动世界');
await run(() => window.__sb.discard(), null);

/* 5b. 危险批次 · 宽松模式：逐条拦截，看清每一种敌意形态 */
await run(() => { document.getElementById('polMode').value = 'lenient'; window.__sb.setPolicy({ mode: 'lenient' }); }, null);
await run(() => { window.__sb.pick(['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9', 'x10', 'x11', 'x13', 'x14']); window.__sb.pack(); window.__sb.preview(); }, null);
const hostile = await run(() => {
  const r = window.__sb.last();
  return { codes: r.problems.concat(r.failed).map((p) => p.code), notes: r.notes.map((n) => n.code), applied: r.applied, skipped: r.skipped, effects: r.effects.length };
}, null);
const hc = new Set(hostile.codes);
ok(hc.has('protected'), '拦下越权路径 protected');
ok(hc.has('not-declarative'), '拦下脚本注入 not-declarative');
ok(hc.has('oversize'), '拦下超大写入 oversize');
ok(hc.has('bad-value'), '拦下非法取值 bad-value');
ok(hc.has('dangling'), '拦下会造成悬挂引用的删除 dangling');
ok(hc.has('unknown-path'), '拦下未声明路径 unknown-path');
eq((await D()).pvProblems, String(hostile.codes.length), '界面拦截数与内核一致');
ok(hostile.notes.includes('proto-keys'), '原型污染键被丢掉并提示：' + hostile.notes.join(','));
/* 原型污染落地检查 */
const polluted = await run(() => (({ }).polluted !== undefined) || ([]).polluted !== undefined, null);
ok(polluted === false, 'Object.prototype 未被污染');
/* 保护区未被改写 */
const guard = await run(() => { const s = window.__sb.state(); return s.secrets.token + '|' + s.ledger.balance; }, null);
eq(guard, 'sk-live-abcdef|100', 'secrets / ledger 保持原值');
await run(() => window.__sb.execute(), null);
ok(/执行被拒/.test(await toast()), '宽松未勾选时也拒绝：' + await toast());
await run(() => window.__sb.discard(), null);

/* 6. 宽松模式 + 接受部分落地 */
await run(() => { document.getElementById('polMode').value = 'lenient'; window.__sb.setPolicy({ mode: 'lenient' }); }, null);
await run(() => { window.__sb.pick(['p1', 'x1', 'x6', 'p2']); window.__sb.pack(); window.__sb.preview(); }, null);
const lenient = await run(() => {
  const r = window.__sb.last();
  return { applied: r.applied, skipped: r.skipped, failed: r.failed.map((f) => f.code), ok: r.ok };
}, null);
eq(lenient.applied, 2, '宽松模式：好指令照常过');
eq(lenient.skipped, 2, '宽松模式：坏指令进 failed');
eq(lenient.failed.includes('protected'), true, 'failed 里有 protected');
await run(() => window.__sb.execute(), null);
ok(/执行被拒/.test(await toast()), '未勾选时部分落地被拒：' + await toast());
await page.check('#polAcceptPartial');
await run(() => window.__sb.execute(), null);
d = await D();
ok(/已执行，生成 #\d+（部分落地/.test(await toast()), '勾选后部分落地：' + await toast());
ok(/部分执行/.test(d.journal + (await run(() => window.__sb.sandbox.head().label, null))), '版本标签标注部分执行');
await run(() => { document.getElementById('polAcceptPartial').checked = false; }, null);
/* 回退掉这批，保持后面用例的起点干净 */
await run(() => window.__sb.revertOne(), null);
await run(() => { window.__sb.setMode('atomic'); document.getElementById('polMode').value = 'atomic'; }, null);

/* 7. 不可逆副作用：预览不外发 → 执行落 sink → 回退需强制 */
await run(() => { window.__sb.pick(['p3', 'x14']); window.__sb.pack(); window.__sb.preview(); }, null);
eq((await D()).sinkCount, '0', '预览阶段 sink 仍为空');
const eff = await run(() => window.__sb.last().effects.map((e) => ({ n: e.name, irr: !!e.irreversible })), null);
eq(eff, [{ n: 'push-sms', irr: true }], '预览列出不可逆副作用');
await run(() => window.__sb.execute(), null);
eq((await D()).sinkCount, '1', '执行后副作用落进 sink');
await run(() => window.__sb.revertOne(), null);
ok(/不可逆/.test(await toast()), '含不可逆副作用时拒绝回退：' + await toast());
eq((await D()).sinkCount, '1', '拒绝回退不会撤回已发出的东西');
await page.check('#polForce');
await run(() => window.__sb.revertOne(), null);
ok(/已回退/.test(await toast()), '强制回退放行：' + await toast());
await run(() => { document.getElementById('polForce').checked = false; }, null);

/* 8. env 漂移：预览后偷改外部值，执行必须拒绝 */
await run(() => { window.__sb.pick(['p6']); window.__sb.pack(); window.__sb.preview(); }, null);
eq((await run(() => window.__sb.last().problems.length, null)), 0, 'env 令牌批次可通过预览');
await run(() => window.__sb.setEnv('weather', '暴雨'), null);
await run(() => window.__sb.execute(), null);
ok(/外部值在执行前变了|env-drift/.test(await toast()), 'env 漂移拒绝执行：' + await toast());
await run(() => { window.__sb.setEnv('weather', '晴'); window.__sb.discard(); }, null);

/* 9. 令牌确定性：同一种子重放，uuid/now 一致 */
const det = await run(() => {
  const sb = window.__sb.sandbox;
  const mk = () => { sb.begin('d' + Math.random(), { seed: 'seed-A', clockISO: '2026-10-27T09:12:00.000Z', env: { weather: '晴' } }); sb.dispatch({ kind: 'set', path: 'tripLog.days.0.mood', value: 'a{{now}}/b{{uuid}}/c{{random}}' }); return sb.dryRun().changes[0].after; };
  const a = mk(), b = mk();
  sb.discard();
  return { a, b };
}, null);
eq(det.a === det.b, true, '同种子重放结果一致');
eq(det.a.startsWith('a2026-10-27T09:12:00.000Z/b'), true, '{{now}}/{{uuid}} 已展开：' + det.a);

/* 10. 限额：批量指令 too-many-ops */
await run(() => { window.__sb.pick(['x12']); window.__sb.pack(); window.__sb.preview(); }, null);
const bulk = await run(() => window.__sb.last().problems.map((p) => p.code), null);
ok(bulk.includes('too-many-ops') || bulk.includes('too-many-changes'), '批量指令被限额拦下：' + bulk.join(','));
await run(() => window.__sb.discard(), null);

/* 11. 重置世界 */
await run(() => window.__sb.reset(), null);
d = await D();
eq(d.sbVersion, '0', '重置后回到版本 #0');
eq(d.sinkCount, '0', '重置后 sink 清空');

/* 截图留档 */
await run(() => { window.__sb.pick(['p1', 'p2', 'x1', 'x3', 'x5', 'x8']); window.__sb.pack(); window.__sb.preview(); }, null);
await page.screenshot({ path: '/tmp/lab.png', fullPage: false });
await browser.close();

console.log('\n实验台 e2e：' + pass + ' 通过 / ' + fail + ' 失败');
if (errors.length) { console.log('浏览器报错：\n' + errors.join('\n')); process.exit(1); }
process.exit(fail ? 1 : 0);
