// 沙盒试验台自检：指令集模型的 预览 / 执行｜回退 / 放弃 语义
// 用法：node sandbox-lab/selfcheck.mjs
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
  return { version: d.sbVersion, pool: d.sbPool, draft: d.sbDraft, committed: d.sbCommitted, reverted: d.sbReverted, discarded: d.sbDiscarded, snaps: d.sbSnaps, active: d.sbActive };
});
const pv = () => page.evaluate(() => {
  const d = document.getElementById('preview').dataset;
  return { steps: d.pvSteps, fail: d.pvFail, changed: d.pvChanged, untouched: d.pvUntouched, kinds: d.pvKinds || '' };
});
const hash = () => page.evaluate(() => window.__sandbox.docHash());
const docCount = () => page.evaluate(() => document.getElementById('doclist').dataset.docCount);
const text = (id) => page.evaluate((x) => window.__sandbox.docText(x), id);
const click = (act, opts) => page.evaluate(([a, o]) => window.__sandbox.click(a, o), [act, opts]);
const pick = (ids) => page.evaluate((x) => window.__sandbox.pick(x), ids);
const toast = () => page.evaluate(() => window.__sandbox.toastText());
const lastSet = () => page.evaluate(() => { const s = window.__sandbox.sets; return s.length ? { id: s[s.length - 1].id, name: s[s.length - 1].name, ids: s[s.length - 1].ids, status: s[s.length - 1].status } : null; });
const setStatus = (name) => page.evaluate((n) => { const s = window.__sandbox.sets.find((x) => x.name === n); return s ? s.status : null; }, name);
const pack = (ids, name) => page.evaluate(([x, n]) => { window.__sandbox.pick(x); if (n) window.__sandbox.setName(n); return true; }, [ids, name]).then(() => click('pack'));

console.log('\n== 沙盒试验台自检（指令集模型）==\n');

await page.goto(url);
await page.waitForSelector('#statusbar .stat');
const h0 = await hash();
ok(errors.length === 0, '页面无 JS 报错', errors);

// 1. 初始：只有指令池，没有集，内容就是原始文章
let s = await stat();
ok(s.version === '0' && s.pool === '11' && s.draft === '0' && s.snaps === '1', '初始：池中 11 条指令，零个指令集，版本 #0', s);

// 2. 打包成集：池中取出，集成为操作单位
await pack(['p1'], '只改出发地');
s = await stat();
ok(s.pool === '10' && s.draft === '1' && s.active === 'draft', '打包「只改出发地」：池 10 条，1 个草稿集，自动成为当前集', s);
ok((await hash()) === h0, '打包本身不改内容');

// 3. 预览只显示有增删改的文章
await click('preview');
let p = await pv();
ok(p.steps === '1' && p.changed === '1' && p.untouched === '2', '预览：1 篇有改动，2 篇未受影响被隐藏', p);
ok((await hash()) === h0, '预览不落盘');

// 4. 执行 → 版本；回退 → 内容回到执行前
await click('execute');
s = await stat();
ok(s.version === '1' && s.committed === '1' && s.snaps === '2', '执行 → 版本 #1，集变已执行', s);
const h1 = await hash();
ok(h1 !== h0 && (await text('a1')).includes('上午九点从断桥出发'), '执行真的落盘');
ok((await page.evaluate(() => document.getElementById('btn-execute').textContent)) === '回退', '执行后底部按钮从「执行」变「回退」');
await click('revert');
s = await stat();
ok(s.version === '2' && s.reverted === '1' && (await hash()) === h0, '回退 → 版本 #2，内容精确回到 #0', s);
ok((await page.evaluate(() => window.__sandbox.history[2].kind)) === 'revert', '回退在历史里是一条 revert，不是抹掉 commit');
await click('set-reedit');
s = await stat();
ok(s.pool === '11' && s.draft === '0', '「整集退回池子」把指令还回池中', s);

// 5. 增 / 删 / 改三类都能被预览分出来
await pack(['p8', 'p9', 'p10'], '增删改混合');
await click('preview');
p = await pv();
ok(p.changed === '3' && p.kinds.includes('add') && p.kinds.includes('del') && p.kinds.includes('mod'), '预览分类：1 增 1 删 1 改', p);
ok(p.untouched === '1', '只有 a2 未受影响，被折叠成计数', p);
await page.screenshot({ path: '/tmp/sandbox-set-preview.png', fullPage: true });
await click('execute');
ok((await docCount()) === '3', '执行后文章数 3（删了 a3、加了新店）', await docCount());
ok((await page.evaluate(() => window.__sandbox.docByTitle('下次想去的三家店'))).includes('运河边那家小馆'), '新建的文章有正文');
ok((await text('a3')) === '', '被删的文章不再存在');
const h2 = await hash();

// 6. 回退按后进先出：晚执行的集没回退时，不许回退早的
await pack(['p2'], '只改人均');
await click('execute');
s = await stat();
ok(s.version === '4' && s.committed === '2', '第二个集执行 → 版本 #4，两个已执行', s);
const hNow = await hash();
await click('set-active', { id: 'S2' });
await click('revert');
s = await stat();
ok(s.version === '4' && (await hash()) === hNow, '先回退较早的「增删改混合」被拒绝：版本和内容都不动', s);
ok((await toast()).includes('更晚的指令集'), '拒绝理由指向后进先出', await toast());
await click('set-active', { id: 'S3' });
await click('revert');
ok((await hash()) === h2 && (await stat()).version === '5', '回退最新的集，正常生效', await stat());
await click('set-active', { id: 'S2' });
await click('revert');
ok((await hash()) === h0 && (await stat()).version === '6', '再回退前一个集，内容回到初始', await stat());

// 7. 集里有跑不通的指令：预览标出来，执行时整条不进，好指令照常提交
await pack(['p7', 'p3'], '含一条坏指令');
await click('preview');
p = await pv();
ok(p.fail === '1' && p.changed === '1', '坏指令在预览里被标出，好指令的改动照常显示', p);
const badErr = await page.evaluate(() => { const x = window.__sandbox.sets.find((k) => k.name === '含一条坏指令'); return x.failed.length ? x.failed[0].err : ''; });
ok(badErr.includes('明天再去一次'), '失败原因写清了找不到哪段原文', badErr);
await click('execute');
s = await stat();
ok(s.version === '7' && (await text('a3')).includes('四、逆光时先拍人'), '执行：好指令提交，坏指令留在集里', s);
ok((await setStatus('含一条坏指令')) === 'committed', '集整体进入已执行', await setStatus('含一条坏指令'));

// 7b. 全坏的集：一条都不提交
await pack(['p11'], '只有坏指令');
await click('execute');
s = await stat();
ok(s.version === '7' && s.snaps === '8' && (await setStatus('只有坏指令')) === 'draft', '全跑不通的集不产生版本，保持草稿', s);
ok((await toast()).includes('一条都跑不通'), '提示「一条都跑不通，没有提交」', await toast());

// 8. 放弃只作用于未执行的集：不产生版本、不改内容、指令回池
const hKeep = await hash();
await click('set-active', { id: 'S5' });
await click('discard');
s = await stat();
ok(s.discarded === '1' && s.version === '7' && (await hash()) === hKeep, '放弃草稿集：不产生版本、内容一字未动', s);
ok(await page.evaluate(() => window.__sandbox.poolIds().includes('p11')), '被放弃的集，指令回到池中');
ok((await toast()).includes('一个字节没动'), '放弃的提示强调没改内容', await toast());
// 已执行的集不给放弃
await click('set-active', { id: 'S4' });
await click('discard');
ok((await setStatus('含一条坏指令')) === 'committed' && (await toast()).includes('只能回退'), '已执行的集拒绝「放弃」，只能回退', await toast());
await click('set-drop', { id: 'S5' });
ok(await page.evaluate(() => !window.__sandbox.sets.some((x) => x.id === 'S5')), '已放弃的集可以删除记录');

// 9. 集内顺序影响结果，重排即作废上一轮判定
await pack(['p6', 'p5'], '先柚子再小柚');
await click('preview');
ok((await pv()).fail === '1', 'p6 排在 p5 前 → 找不到「小柚」，1 条跑不通', await pv());
await click('set-move', { id: 'p6', dir: 1 });
await click('preview');
p = await pv();
ok(p.fail === '0' && p.changed === '2', '把 p6 挪到 p5 后面 → 全通，2 篇有改动', p);
await click('execute');
ok((await text('a1')).includes('柚子') && !(await text('a1')).includes('她'), '执行后顺序生效', (await text('a1')).slice(0, 60));

// 10. 历史版本差异同样只列增删改
await click('hist-diff', { seq: 0 });
const hd = await pv();
ok(Number(hd.changed) > 0 && Number(hd.untouched) >= 0, '历史差异按同一套「只看改动」渲染', hd);
await page.screenshot({ path: '/tmp/sandbox-set-final.png', fullPage: true });
ok(errors.length === 0, '全程无 JS 报错', errors);

console.log('\n========== 汇总 ==========');
console.log(fail === 0 ? '全部通过 ✓ (' + pass + ')' : '通过 ' + pass + '，失败 ' + fail + ' ✗');
await browser.close();
process.exit(fail === 0 ? 0 : 1);
