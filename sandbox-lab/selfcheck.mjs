// 沙盒试验台自检：预览 / 执行 / 放弃 / 恢复 的语义验证
// 用法：node sandbox-lab/selfcheck.mjs   （需要本机 playwright + chromium）
import { chromium } from '/usr/local/node/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(here, 'index.html');

let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const stat = () => page.evaluate(() => {
  const d = document.body.dataset;
  return { version: d.sbVersion, pending: d.sbPending, needs: d.sbNeeds, applied: d.sbApplied, discarded: d.sbDiscarded, snaps: d.sbSnaps };
});
const pv = () => page.evaluate(() => {
  const d = document.getElementById('preview').dataset;
  return { steps: d.pvSteps, fail: d.pvFail, docs: d.pvDocs };
});
const hash = () => page.evaluate(() => document.getElementById('doclist').dataset.docHash);
const text = (id) => page.evaluate((x) => window.__sandbox.docText(x), id);
const click = (act, opts) => page.evaluate(([a, o]) => window.__sandbox.click(a, o), [act, opts]);
const pick = (ids) => page.evaluate((x) => window.__sandbox.pick(x), ids);
const allIds = () => page.evaluate(() => window.__sandbox.instructions.map((i) => i.id));
const toast = () => page.evaluate(() => window.__sandbox.toastText());
const previewText = () => page.textContent('#preview');

console.log('\n== 沙盒试验台自检 ==\n');

await page.goto(url);
await page.waitForSelector('#statusbar .stat');
const h0 = await hash();
ok(errors.length === 0, '页面无 JS 报错', errors);

// 1. 初始状态
let s = await stat();
ok(s.version === '0' && s.pending === '8' && s.applied === '0' && s.snaps === '1', '初始：版本 #0，8 条待执行，只有 1 个初始快照', s);

// 2. 预览是纯函数：跑完 8 条，docs 一字未动
await click('preview');
let p = await pv();
ok(p.steps === '8' && p.fail === '1', '预览跑完 8 步，1 条（i7）被拒绝', p);
s = await stat();
ok(s.needs === '1', '被拒绝的指令进「需复核」，不是被丢掉', s);
ok((await hash()) === h0, '预览之后 docs 完全没变（纯函数）');
ok((await text('a1')).includes('上午九点出发'), '预览不落盘：a1 仍是原文');
await page.screenshot({ path: '/tmp/sandbox-preview.png', fullPage: true });

// 3. 预览可反复点，结果稳定
await click('preview');
const p2 = await pv();
ok(JSON.stringify(p2) === JSON.stringify(p), '预览可重复，结果一致', { p, p2 });

// 4. 顺序依赖：单条预览 i6 必失败（它要的「小柚」还不存在）
await click('preview-one', { id: 'i6' });
ok((await pv()).fail === '1', '单条预览 i6 失败：依赖前置产物');
ok((await previewText()).includes('前置'), '失败提示指向「需要前置指令先跑」');

// 4b. 把 i6 挪到 i5 前面，整条预览的失败数从 1 变 2
await pick(await allIds());
await click('move', { id: 'i6', dir: -1 });
await click('preview');
p = await pv();
ok(p.fail === '2', '顺序一变，i6 失去前置 → 失败数 1→2', p);
s = await stat();
ok(s.needs === '2' && (await hash()) === h0, '重排后需复核 2 条，docs 仍未动', s);
await click('move', { id: 'i6', dir: 1 });
await click('preview');
ok((await pv()).fail === '1', '挪回原位，失败数回到 1');

// 5. 放弃只改指令状态，内容一个字节都不动
await pick(['i7']);
await click('discard-one', { id: 'i7' });
s = await stat();
ok(s.discarded === '1' && s.pending === '7' && s.needs === '0', '放弃 i7：需复核清零，待执行剩 7', s);
ok((await hash()) === h0, '放弃之后 docs 依然一字未动');

// 6. 执行 = 把预览结果提交成新版本
await pick(['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i8']);
await click('execute');
s = await stat();
ok(s.version === '1' && s.snaps === '2' && s.applied === '7' && s.pending === '0', '执行 7 条 → 版本 #1，7 条已执行', s);
const h1 = await hash();
ok(h1 !== h0, '执行之后 docs 真的变了');
const a1 = await text('a1');
const a2 = await text('a2');
const a3 = await text('a3');
ok(a1.includes('柚子') && a2.includes('柚子') && !a1.includes('小柚'), 'i5→i6 链路生效：她 → 小柚 → 柚子');
ok(a1.includes('雨天备案') && a1.includes('上午九点从断桥出发'), 'i1/i8 生效');
ok(a2.includes('人均 150') && a2.startsWith('2026-10-18'), 'i2 替换 + i4 改标题生效', a2.slice(0, 24));
ok(a3.split('\n').length === 5, 'i3 让 a3 多出一段', a3.split('\n').length);
ok((await toast()).includes('已提交'), '执行给出提交号', await toast());

// 7. 队列空了，执行按钮置灰
ok(await page.evaluate(() => document.getElementById('btn-execute').disabled), '无可执行指令时「执行」置灰');

// 8. 恢复：回到 #0，现场被存下来，晚于它的执行退回队列
await click('restore', { seq: 0 });
s = await stat();
ok(s.version === '3' && s.snaps === '4', '恢复产生 2 个快照：现场 + 恢复记录', s);
ok((await hash()) === h0, '恢复后内容 == 初始内容');
s = await stat();
ok(s.applied === '0' && s.pending === '7' && s.discarded === '1', '那次执行的 7 条指令退回待执行（可重跑）', s);
await click('restore', { seq: 1 });
ok((await hash()) === h1, '反向恢复：回到 #1 又拿回执行后的内容');
s = await stat();
ok(s.applied === '7' && s.pending === '0', '恢复到 #1 时，那 7 条标回已执行，不会重复跑', s);

// 9. 找回已放弃的指令；坏指令整条拒绝，绝不部分写入
await click('requeue', { id: 'i7' });
await pick(['i7']);
await click('execute');
s = await stat();
ok(s.needs === '1', 'i7 找回后单独执行 → 进需复核', s);
ok(s.snaps === '6' && s.version === '5' && (await hash()) === h1, '跑不通的执行不产生快照、不改内容', s);
ok((await toast()).includes('全部跑不通'), '提示是「全部跑不通，没有提交」', await toast());

// 10. 自己加一条指令：入队不等于改内容
await page.evaluate(() => window.__sandbox.click('toggle-composer'));
await page.selectOption('#c-target', 'a1');
await page.selectOption('#c-op', 'append');
await page.fill('#c-text', '测试段落：自建指令');
await page.evaluate(() => window.__sandbox.click('add-instruction'));
const nid = await page.evaluate(() => window.__sandbox.instructions[window.__sandbox.instructions.length - 1].id);
s = await stat();
ok(s.discarded === '0' && s.applied === '7', '新指令入队不动已有状态', s);
ok((await hash()) === h1, '新指令只是入队，内容没变');
await pick([nid]);
await click('preview');
p = await pv();
ok(p.steps === '1' && p.fail === '0' && p.docs === '1', '单条自建指令预览成功', p);
ok((await hash()) === h1, '自建指令预览同样不落盘');
await click('execute');
ok((await text('a1')).includes('测试段落：自建指令'), '自建指令执行后真的落进 a1');

// 11. 差异视图 + 无报错
await click('restore-diff', { seq: 0 });
ok((await previewText()).includes('差异'), '版本差异可查');
await page.screenshot({ path: '/tmp/sandbox-final.png', fullPage: true });
ok(errors.length === 0, '全程无 JS 报错', errors);

console.log('\n========== 汇总 ==========');
console.log(fail === 0 ? '全部通过 ✓ (' + pass + ')' : '通过 ' + pass + '，失败 ' + fail + ' ✗');
await browser.close();
process.exit(fail === 0 ? 0 : 1);
