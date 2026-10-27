/**
 * 沙盒内核自检 · 把 AI 可能造成的破坏逐条钉死
 *
 *   node ai-sandbox/selfcheck.mjs
 *
 * 全部在 Node 里跑，不需要浏览器：内核不碰 DOM，这也是它能同时被 App、脚本和 CI
 * 复用的前提。用例按「AI 会怎么伤人」分组，每组都是一条防线。
 */

import {
  createSandbox, clone, canon, sameState, leaves, joinPath, parsePath,
  matchPattern, ruleFor, diffTrees, classify, resolveTokens, bytes, getAt, truncate,
  PROTECTED_SEGMENTS, FORBIDDEN_KINDS, OP_KINDS,
} from './core.mjs';

/* ---------------------------------------------------------------- 测试装置 */

let pass = 0;
let fail = 0;
const failures = [];

function group(t) { console.log('\n▸ ' + t); }
function ok(cond, msg, extra) {
  if (cond) { pass++; return true; }
  fail++;
  failures.push(msg);
  console.log('  ✗ ' + msg + (extra !== undefined ? '  →  ' + truncate(JSON.stringify(extra), 220) : ''));
  return false;
}
function eq(a, b, msg) { return ok(sameState(a, b), msg, { got: truncate(JSON.stringify(canon(a)), 120), want: truncate(JSON.stringify(canon(b)), 120) }); }

const H = (o) => JSON.stringify(canon(o));

function sb(extra) {
  const e = extra || {};
  return createSandbox({
    world: clone(world),
    schema: clone(schema),
    effects: clone(effects),
    env: Object.assign({ weather: '晴', temperature: '21' }, e.env || {}),
    policy: e.policy,
    at: 'T0',
  });
}

/** 一批指令跑一趟预览 */
function run(ops, opts) {
  const o = Object.assign({ seed: 1, clockISO: '2026-10-27T00:00:00.000Z', mode: 'atomic' }, opts || {});
  const s = sb(o);
  s.begin(o.name || '批次', { seed: o.seed, clockISO: o.clockISO, mode: o.mode, env: o.env });
  (Array.isArray(ops) ? ops : [ops]).forEach((x) => s.dispatch(x));
  return { s, r: s.dryRun() };
}

const codes = (r) => (r.problems || []).map((p) => p.code);
const has = (r, c) => codes(r).includes(c) || (r.failed || []).some((f) => f.code === c);
const first = (r, c) => (r.problems || []).find((p) => p.code === c) || (r.failed || []).find((f) => f.code === c);

/* ---------------------------------------------------------------- 世界与契约 */

const world = {
  docs: {
    a1: { id: 'a1', title: '西湖徒步路线笔记', body: '从北山街出发，经过断桥、白堤到孤山。', tags: ['徒步', '西湖'], color: '#2f6f5e', updatedAt: '2026-05-01', pinned: false },
    a2: { id: 'a2', title: '第一次见面的餐厅记录', body: '门口有盏黄灯，靠窗的位子安静。', tags: ['餐厅'], color: '#b3543a', updatedAt: '2026-05-06', pinned: true },
    a3: { id: 'a3', title: '关于拍照的三条经验', body: '一是逆光别硬拍，三是记得带充电宝。', tags: ['拍照'], color: '#3a5fb3', updatedAt: '2026-05-09', pinned: false },
  },
  tripLog: {
    days: [
      { date: '2026-05-01', title: '西湖', docIds: ['a1'] },
      { date: '2026-05-06', title: '餐厅', docIds: ['a2', 'a3'] },
    ],
    note: '两天，三个地方。',
  },
  settings: { theme: 'auto', fontSize: 16 },
  secrets: { token: 'sk-live-abcdef' },
  ledger: { balance: 100 },
};

const schema = [
  { path: 'docs', entity: {
    id: { type: 'string' },
    title: { type: 'string', min: 1, max: 40 },
    body: { type: 'string', max: 2000 },
    tags: { type: 'array', items: 'string', maxItems: 6 },
    color: { type: 'hex' },
    updatedAt: { type: 'date' },
    pinned: { type: 'boolean' },
    mood: { type: 'string', max: 12 },
    ref: { type: 'string', max: 120 },
  } },
  { path: 'docs.*.id', type: 'string' },
  { path: 'docs.*.title', type: 'string', min: 1, max: 40 },
  { path: 'docs.*.body', type: 'string', max: 2000 },
  { path: 'docs.*.tags', type: 'array', items: 'string', maxItems: 6 },
  { path: 'docs.*.color', type: 'hex' },
  { path: 'docs.*.updatedAt', type: 'date' },
  { path: 'docs.*.pinned', type: 'boolean' },
  { path: 'tripLog.days', type: 'array', maxItems: 60, entity: {
    date: { type: 'date' },
    title: { type: 'string', max: 30 },
    docIds: { type: 'array', items: 'string', maxItems: 10, ref: 'docs' },
    mood: { type: 'string', max: 12 },
  } },
  { path: 'tripLog.days.*.date', type: 'date' },
  { path: 'tripLog.days.*.title', type: 'string', max: 30 },
  { path: 'tripLog.days.*.docIds', ref: 'docs', type: 'array', items: 'string', maxItems: 10 },
  { path: 'tripLog.days.*.mood', type: 'string', max: 12 },
  { path: 'tripLog.note', type: 'string', max: 120 },
  { path: 'settings.fontSize', type: 'number', min: 12, max: 28 },
  { path: 'settings.theme', type: 'string', enum: ['auto', 'light', 'dark'] },
  { path: 'settings.*', type: 'any' },
  { path: 'auditTrail', type: 'array', maxItems: 50 },
  { path: 'auditTrail.**', type: 'string' },
];

const effects = {
  'notify': { describe: '给用户推一条消息', compensate: 'cancel-notify' },
  'sync-calendar': { describe: '写入系统日历', compensate: 'remove-calendar' },
  'push-sms': { describe: '发短信，收回去也还是发出去了', irreversible: true },
  'export-zip': { describe: '没有补偿方式的副作用' },
};

/* ================================================================ A 基础流 */

group('A 基础流：正常指令该怎么走');
{
  const { s, r } = run({ id: 't1', kind: 'set', path: 'docs.a1.title', value: '西湖徒步（修订版）' });
  ok(r.ok, 'A1 正常改标题预览通过', r.problems);
  ok(r.changes.length === 1 && r.changes[0].kind === 'mod', 'A2 预览给出 1 处 mod', r.changes);
  eq(s.state(), clone(world), 'A3 预览不改动已提交状态');
  const c = s.commit();
  ok(c.ok && c.version === 1 && c.changed === 1, 'A4 提交生成 #1', c);
  ok(s.state().docs.a1.title === '西湖徒步（修订版）', 'A5 提交后状态已更新');
  s.begin('写同值', { seed: 2 });
  s.dispatch({ id: 't2', kind: 'set', path: 'docs.a1.title', value: '西湖徒步（修订版）' });
  const r2 = s.dryRun();
  ok(r2.ok && r2.changes.length === 0, 'A6 写同值时改动数为 0', r2.changes);
  const c2 = s.commit();
  ok(c2.ok && c2.noop && c2.version === 1, 'A7 无变化的提交不产生新版本', c2);
  const j = s.journal();
  ok(j.length === 2 && j[0].kind === 'seed' && j[1].kind === 'commit', 'A8 流水为 seed→commit', j);
  const rev = s.revert();
  ok(rev.ok && rev.version === 2 && rev.backTo === 0, 'A9 回退生成新版本 #2', rev);
  eq(s.state(), clone(world), 'A10 回退后与初始逐字段相同');
  ok(s.journal()[2].kind === 'revert', 'A11 流水里追加的是 revert，不是删除');
  ok(H(s.snapshotOf(0)) === H(world), 'A12 每版快照可查');
}
{
  const ops = [
    { id: 'i1', kind: 'insert', path: 'docs.a1.tags', value: '秋日' },
    { id: 'i2', kind: 'reorder', path: 'tripLog.days', from: 1, to: 0 },
    { id: 'i3', kind: 'delete', path: 'tripLog.note' },
  ];
  const { s, r } = run(ops);
  ok(r.ok && r.applied === 3, 'A13 insert/reorder/delete 混在一批可通过', r.problems);
  const c = s.commit();
  ok(c.ok && s.state().docs.a1.tags.indexOf('秋日') === 2 && s.state().tripLog.days[0].title === '餐厅', 'A14 三种操作都落到位', s.state());
  ok(!('note' in s.state().tripLog), 'A15 delete 真的删掉了字段');
  const rev = s.revert();
  ok(rev.ok, 'A16 混合批次可回退', rev);
  eq(s.state(), clone(world), 'A17 回退后完全复原');
}
{
  const s = sb();
  s.begin('放弃批次', { seed: 1 });
  s.dispatch({ id: 'x', kind: 'set', path: 'docs.a1.title', value: '不该存在' });
  const n = s.discard();
  ok(n === 1 && s.pending().length === 0, 'A18 放弃丢掉草稿指令', n);
  eq(s.state(), clone(world), 'A19 放弃不动状态');
  ok(s.commit().code === 'no-batch', 'A20 放弃后提交报 no-batch');
  ok(s.dryRun().problems[0].code === 'no-batch', 'A21 无批次预览报 no-batch');
}
{
  const { r } = run({ id: 'b1', kind: 'bulk', ops: [
    { kind: 'set', path: 'docs.a1.pinned', value: true },
    { kind: 'bulk', ops: [
      { kind: 'set', path: 'docs.a2.pinned', value: false },
      { kind: 'set', path: 'docs.a3.pinned', value: true },
    ] },
  ] });
  ok(r.ops === 3 && r.applied === 3, 'A22 bulk 递归展开后计数为 3', { ops: r.ops, applied: r.applied, problems: r.problems });
  ok(r.flat[0].id === 'b1#0' && r.flat[1].id === 'b1#1#0', 'A23 展开后的 id 带层级路径', r.flat.map((o) => o.id));
  ok(s_state_pinned(r), 'A24 布尔值没被当成字符串（safeValue 保真）', r.changes);
  function s_state_pinned(res) { return res.changes.some((c) => c.after === true || c.after === false); }
}

/* ================================================================ B 保护与污染 */

group('B 保护区、原型污染与非声明式指令');
{
  const cases = [
    ['sandbox.journal', 'protected'],
    ['secrets.token', 'protected'],
    ['ledger.balance', 'protected'],
    ['keys.id', 'protected'],
    ['env.weather', 'protected'],
    ['docs.a1.__proto__.polluted', 'protected'],
    ['docs.a1.constructor.name', 'protected'],
    ['tripLog.days.prototype.x', 'protected'],
  ];
  cases.forEach(([p, code]) => {
    const { r } = run({ id: 'p', kind: 'set', path: p, value: 'x' });
    ok(has(r, code), 'B1 禁写路径 ' + p + ' → ' + code, codes(r));
  });
  ok(world.docs.a1.polluted === undefined && !('polluted' in world.docs.a1), 'B2 宿主对象没被污染');
  ok(({}).polluted === undefined && [].polluted === undefined, 'B3 Object.prototype 未被改写');
}
{
  const evil = JSON.parse('{"id":"e1","kind":"set","path":"settings.theme","value":"dark","__proto__":{"polluted":1}}');
  const s = sb();
  s.begin('污染尝试', { seed: 1 });
  const disp = s.dispatch(evil);
  ok(disp.ok === true, 'B4 带 __proto__ 键的指令可入草稿（该键被丢弃）', disp);
  const r = s.dryRun();
  ok(r.ok && r.changes.length === 1, 'B5 该指令其余字段照常校验并生效', r.problems);
  ok(r.notes.some((n) => n.code === 'proto-keys'), 'B6 预览里能看到原型键被丢弃', r.notes);
  s.commit();
  ok(({}).polluted === undefined && world.docs.polluted === undefined, 'B7 原型污染失败');
  eq(Object.prototype, ({}), 'B8 Object.prototype 仍是默认原型');
}
{
  const s = sb();
  s.begin('函数指令', { seed: 1 });
  const disp = s.dispatch({ id: 'f1', kind: 'set', path: 'settings.theme', value() { return 'dark'; } });
  ok(disp.ok === false && disp.code === 'not-declarative', 'B9 值是函数 → 入口直接拒', disp);
  ok(String(disp.msg).includes('不可执行内容'), 'B10 拒绝理由写明含不可执行内容', disp.msg);
  const s2 = sb();
  s2.begin('代码载荷', { seed: 1 });
  s2.dispatch({ id: 'f9', kind: 'set', path: 'settings.theme', value: 'dark', eval: 'require("fs").rmSync("/")', script: 'alert(1)' });
  const rr = s2.dryRun();
  ok(rr.ok && rr.changes.length === 1 && rr.changes[0].path === 'settings.theme', 'B11 顶层混入 eval/script 字段也只是数据，不会被执行', rr.changes);
}
{
  const s = sb();
  s.begin('Symbol', { seed: 1 });
  const op = { id: 'f2', kind: 'set', path: 'settings.theme', value: 'dark' };
  op[Symbol('s')] = 'x';
  ok(s.dispatch(op).ok, 'B12 Symbol 键被丢弃，指令本身可用');
  ok(s.dryRun().ok, 'B13 丢弃 Symbol 后预览通过');
}
{
  ['script', 'function', 'eval', 'import', 'raw-sql', 'shell', 'html', 'fetch', 'command'].forEach((k) => {
    const { r } = run({ id: 'k', kind: k, code: 'rm -rf /' });
    ok(has(r, 'not-declarative'), 'B14 kind:' + k + ' → not-declarative', codes(r));
  });
  const { r } = run({ id: 'k2', kind: 'transform', path: 'settings.theme' });
  ok(has(r, 'bad-kind'), 'B15 没见过的 kind → bad-kind', codes(r));
  ['__proto__', 'constructor', 'prototype'].forEach((k) => {
    const { r } = run({ id: 'k3', kind: k, path: 'settings.theme', value: 'dark' });
    ok(has(r, 'bad-kind'), 'B16 kind:' + k + ' 只会被当未知 kind，不会走特殊属性', codes(r));
  });
}
{
  const bad = ['不是对象', null, 42, [{ kind: 'set' }]];
  bad.forEach((v, i) => {
    const s = sb();
    s.begin('怪指令' + i, { seed: 1 });
    const d = s.dispatch(v);
    ok(d.ok === false && d.code === 'not-declarative', 'B17 指令形态 ' + truncate(JSON.stringify(v), 14) + ' → 入口拒', d);
  });
}
{
  const { r } = run({ id: 'n1', kind: 'set', path: 'settings.theme' });
  ok(has(r, 'bad-value'), 'B18 set 缺 value → bad-value', codes(r));
  const { r: r2 } = run({ id: 'n2', kind: 'insert', path: 'docs.a1.tags' });
  ok(has(r2, 'bad-value'), 'B19 insert 缺 value → bad-value', codes(r2));
  const { r: r3 } = run({ id: 'n3', kind: 'set', path: '', value: 1 });
  ok(has(r3, 'bad-path'), 'B20 空路径 → bad-path', codes(r3));
}

/* ================================================================ C schema */

group('C 类型、枚举、区间与未知路径');
{
  const cases = [
    ['docs.a1.title', 12345, '数字写进字符串字段'],
    ['docs.a1.title', '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一', '标题超过 40 字'],
    ['docs.a1.color', 'red', '颜色不是 #rrggbb'],
    ['docs.a1.updatedAt', '五月一号', '日期不是 YYYY-MM-DD'],
    ['docs.a1.pinned', 'true', '布尔写成字符串'],
    ['docs.a1.tags', ['a', 'b', 'c', 'd', 'e', 'f', 'g'], '标签超过 6 个'],
    ['docs.a1.body', {}, '正文写成对象'],
    ['settings.theme', 'neon', '主题不在枚举内'],
    ['settings.fontSize', 200, '字号超过上限'],
    ['settings.fontSize', 8, '字号低于下限'],
    ['settings.fontSize', '16', '字号写成字符串'],
    ['settings.fontSize', null, '字号写成 null'],
    ['tripLog.days.0.docIds', ['a1', 'a2', 'a3', 'a1', 'a2', 'a3', 'a1', 'a2', 'a3', 'a1', 'a2'], '引用数组超过 10 项'],
    ['tripLog.days.*', 'x', '通配符只用于声明，不是真实路径', 'unknown-path'],
  ];
  cases.forEach(([p, v, why, want]) => {
    const code = want || 'bad-value';
    const { r } = run({ id: 'c', kind: 'set', path: p, value: v });
    ok(!r.ok && has(r, code), 'C1 拒绝：' + why + '（' + p + '）', { codes: codes(r), msg: first(r, code) && first(r, code).msg });
  });
  ok(first(run({ id: 'c', kind: 'set', path: 'docs.a1.title', value: 12345 }).r, 'bad-value').msg.includes('应为字符串'), 'C2 报错说清期望类型');
  ok(first(run({ id: 'c', kind: 'set', path: 'settings.theme', value: 'neon' }).r, 'bad-value').fix.includes('auto'), 'C3 修复建议带上允许值');
  ok(run({ id: 'c', kind: 'set', path: 'docs.a1.color', value: '#FFFFFF' }).r.ok, 'C4 大写十六进制颜色放行');
}
{
  const { r } = run({ id: 'u1', kind: 'set', path: 'docs.a1.mood', value: '挺好' });
  ok(has(r, 'unknown-path'), 'C5 未声明字段在 strict 下拒绝', codes(r));
  const { r: r2 } = run({ id: 'u1', kind: 'set', path: 'docs.a1.mood', value: '挺好' }, { policy: { unknownPath: 'open' } });
  ok(r2.ok && r2.changes.length === 1, 'C6 同一指令在 open 下放行', r2.problems);
  const { r: r3 } = run({ id: 'u2', kind: 'set', path: 'tripLog.days.0.mood', value: '开心' });
  ok(r3.ok, 'C7 声明过的路径新增键放行');
  const { r: r4 } = run({ id: 'u3', kind: 'set', path: 'settings.fontSize.px', value: 1 });
  ok(has(r4, 'bad-path'), 'C8 路径中段是数字 → bad-path', codes(r4));
  const { r: r5 } = run({ id: 'u4', kind: 'set', path: 'a.b.c.d.e.f.g.h.i.j.k.l.m', value: 1 });
  ok(has(r5, 'bad-path') || has(r5, 'unknown-path') || has(r5, 'no-target'), 'C9 13 段深路径被拦', codes(r5));
  const { r: r6 } = run({ id: 'u5', kind: 'set', path: 'docs.a1', value: { id: 'a1', title: 'x', extra: { deep: { deeper: { d: [[[1, 2, 3]]] } } } } });
  ok(!r6.ok && has(r6, 'unknown-path'), 'C10 整对象写入时未知子字段照样逐个查', codes(r6));
  const { r: r7 } = run({ id: 'u6', kind: 'set', path: 'docs.aX.title', value: '凭空造实体' });
  ok(has(r7, 'no-target'), 'C11 set 不能凭空造出实体（防止无 id 的幽灵记录）', codes(r7));
}
{
  const { r } = run({ id: 'r1', kind: 'set', path: 'tripLog.days.0.docIds', value: ['a1', 'aX'] });
  ok(has(r, 'bad-ref'), 'C12 引用不存在的实体 → bad-ref', codes(r));
  ok(first(r, 'bad-ref').msg.includes('docs'), 'C13 报错指出引用池');
  ok(run({ id: 'r2', kind: 'set', path: 'tripLog.days.0.docIds', value: ['a1', 'a3'] }).r.ok, 'C14 合法引用放行');
  const { r: r3 } = run({ id: 'r3', kind: 'insert', path: 'tripLog.days', value: { date: '2026-05-11', title: '博物馆', docIds: ['a9'] } });
  ok(has(r3, 'bad-ref'), 'C15 insert 整条记录时同样检查引用', codes(r3));
}

/* ================================================================ D 删除与悬挂 */

group('D 删除、引用完整性与级联');
{
  const { r } = run({ id: 'd1', kind: 'delete', path: 'docs.a3' });
  ok(has(r, 'dangling'), 'D1 删除被引用实体 → dangling', codes(r));
  ok(first(r, 'dangling').msg.includes('tripLog.days.1.docIds'), 'D2 报错列出悬挂位置', first(r, 'dangling'));
  const { s, r: r2 } = run({ id: 'd3', kind: 'delete', path: 'docs.a3', cascade: true });
  ok(r2.ok, 'D3 cascade:true 允许级联清理', r2.problems);
  const c = s.commit();
  ok(c.ok, 'D4 级联删除可提交', c);
  ok(!s.state().docs.a3, 'D5 实体已删');
  eq(s.state().tripLog.days[1].docIds, ['a2'], 'D6 引用数组里只剩 a2', s.state().tripLog.days[1].docIds);
  ok(r2.notes.some((n) => n.code === 'cascade'), 'D7 预览说明发生了级联', r2.notes);
  const rev = s.revert();
  ok(rev.ok, 'D8 级联删除可回退', rev);
  eq(s.state(), clone(world), 'D9 回退后实体与引用都复原');
}
{
  ok(has(run({ id: 'd4', kind: 'delete', path: 'docs.aX' }).r, 'no-target'), 'D10 删不存在的东西 → no-target');
  ok(has(run({ id: 'd5', kind: 'delete', path: 'tripLog.days.9' }).r, 'no-target'), 'D11 数组越界删除 → no-target');
  const { r: r3 } = run({ id: 'd6', kind: 'delete', path: 'docs.a2', cascade: true, expect: { id: 'a2' } });
  ok(has(r3, 'conflict'), 'D12 删除带前值断言时同样比对', codes(r3));
  const s = sb();
  s.begin('删掉再引用', { seed: 1 });
  s.dispatchAll([{ id: 'a', kind: 'delete', path: 'docs.a3', cascade: true }, { id: 'b', kind: 'set', path: 'tripLog.days.0.docIds', value: ['a3'] }]);
  const r4 = s.dryRun();
  ok(s.has === undefined && has(r4, 'bad-ref'), 'D13 同一批内先删后引用 → bad-ref（按顺序复核）', codes(r4));
}

/* ================================================================ E 限额 */

group('E 规模防线：大写入、多指令、大爆炸');
{
  const { r } = run({ id: 'z1', kind: 'set', path: 'docs.a1.body', value: '一'.repeat(2000) }, { policy: { maxBytes: 256 } });
  ok(has(r, 'oversize'), 'E1 超大单条写入被限', codes(r));
  const many = [];
  for (let i = 0; i < 6; i++) many.push({ id: 'm' + i, kind: 'set', path: 'settings.fontSize', value: 12 + (i % 3) });
  const { r: r2 } = run(many, { policy: { maxOps: 3 } });
  ok(has(r2, 'too-many-ops') && r2.aborted, 'E2 超过 maxOps 整批中止', codes(r2));
  const { r: r3 } = run(many, { policy: { maxChanges: 2, maxOps: 20 } });
  ok(has(r3, 'too-many-changes') || r3.changes.length <= 2, 'E3 影响面超过上限被拦', { codes: codes(r3), changes: r3.changes.length });
  const bulkBig = { id: 'b', kind: 'bulk', ops: many.map((m) => Object.assign({}, m)) };
  const { r: r4 } = run(bulkBig, { policy: { maxOps: 3 } });
  ok(has(r4, 'too-many-ops'), 'E4 bulk 展开后计入 maxOps', { ops: r4.ops, codes: codes(r4) });
  const cyc = { id: 'c', kind: 'bulk', ops: [] };
  cyc.ops.push({ kind: 'set', path: 'settings.theme', value: 'dark' }, cyc);
  const { r: r5 } = run(cyc);
  ok(has(r5, 'not-declarative'), 'E5 自引用 bulk 被识破', { codes: codes(r5), failed: r5.failed });
  const deep = { id: 'd', kind: 'bulk', ops: [] };
  let node = deep;
  for (let i = 0; i < 20; i++) { const nx = { kind: 'bulk', ops: [] }; node.ops.push(nx); node = nx; }
  const { r: r6 } = run(deep);
  ok(has(r6, 'not-declarative'), 'E6 20 层嵌套 bulk 被深度上限拦住', codes(r6));
  const wide = [];
  for (let i = 0; i < 500; i++) wide.push({ id: 'w' + i, kind: 'set', path: 'settings.theme', value: 'dark' });
  const { r: r7 } = run(wide);
  ok(has(r7, 'too-many-ops') && r7.ops === 500, 'E7 默认 200 条上限对 500 条生效', { ops: r7.ops, codes: codes(r7) });
  const { r: r8 } = run({ id: 'e8', kind: 'bulk', ops: '不是数组' });
  ok(has(r8, 'not-declarative'), 'E8 bulk.ops 不是数组也不炸', codes(r8));
}

/* ================================================================ F 前值断言 */

group('F 前值断言：AI 基于旧版本发的指令要撞车');
{
  ok(run({ id: 'f0', kind: 'set', path: 'docs.a1.title', value: '新标题', expect: '西湖徒步路线笔记' }).r.ok, 'F1 断言与当前值相符 → 通过');
  const { r: r2 } = run({ id: 'f1', kind: 'set', path: 'docs.a1.title', value: '新标题', expect: '我记错了标题' });
  ok(has(r2, 'conflict'), 'F2 断言不符 → conflict', codes(r2));
  ok(first(r2, 'conflict').msg.includes('期望'), 'F3 冲突信息带期望值与实际值', first(r2, 'conflict').msg);
  const s = sb();
  s.begin('先提交', { seed: 1 });
  s.dispatch({ id: 'a', kind: 'set', path: 'docs.a1.title', value: '已被别的批次改掉' });
  s.commit();
  s.begin('再提交', { seed: 2 });
  s.dispatch({ id: 'b', kind: 'set', path: 'docs.a1.title', value: '覆盖', expect: '西湖徒步路线笔记' });
  ok(has(s.dryRun(), 'conflict'), 'F4 跨批次改动被断言捕获');
  const { r: r5 } = run({ id: 'f5', kind: 'delete', path: 'docs.a1', expect: clone(world.docs.a1), cascade: true });
  ok(!has(r5, 'conflict'), 'F5 断言给出完整旧值时通过', codes(r5));
  const { r: r6 } = run({ id: 'f6', kind: 'delete', path: 'docs.a1', expect: { id: 'a1', title: '西湖徒步路线笔记' }, cascade: true });
  ok(has(r6, 'conflict'), 'F6 断言按整值比对，不接受部分匹配', codes(r6));
}

/* ================================================================ G 令牌与幂等 */

group('G 非确定值：冻结令牌、可重放、外部快照');
{
  const op = { id: 'g1', kind: 'create', at: 'docs', value: { title: '新的备忘', body: '建于 {{now}}', color: '#123456', tags: [], updatedAt: '2026-10-27', pinned: false, ref: 'uuid={{uuid}} 掷骰={{random}}' } };
  const a = run(op);
  const b = run(op);
  ok(a.r.ok, 'G1 带令牌的 create 通过', a.r.problems);
  const ent = (x) => Object.values(x.s.state().docs).find((d) => d.title === '新的备忘');
  a.s.commit(); b.s.commit();
  const ea = ent(a); const eb = ent(b);
  ok(!!ea && !!eb && ea.ref === eb.ref, 'G2 同种子同指令两次执行的非确定值一致', { a: ea && ea.ref, b: eb && eb.ref });
  ok(ea && ea.body.includes('2026-10-27T00:00:00.000Z'), 'G3 {{now}} 落在批次时钟上', ea && ea.body);
  ok(a.r.notes.some((n) => n.code === 'token'), 'G4 预览说明令牌被冻结', a.r.notes);
  const c = run(Object.assign({}, op, { id: 'g2' }), { seed: 99 });
  c.s.commit();
  const ec = ent(c);
  ok(ec && ec.ref !== ea.ref, 'G5 换种子得到不同的随机值', ec && ec.ref);
  ok(ec && ec.body === ea.body, 'G6 时钟未变时 {{now}} 不受种子影响', ec && ec.body);
}
{
  const { s, r } = run({ id: 'g3', kind: 'set', path: 'tripLog.note', value: '今天{{env:weather}}，{{env:temperature}} 度' });
  ok(r.ok && r.changes[0].after === '今天晴，21 度', 'G7 env 快照写进值里', r.changes);
  ok(r.envDeps.includes('weather') && r.envDeps.includes('temperature'), 'G8 外部依赖被登记', r.envDeps);
  ok(s.checkDeterminism().stable, 'G9 同一批两次预览逐字稳定');
  const { s: s2, r: r2 } = run({ id: 'g4', kind: 'set', path: 'tripLog.note', value: '今天{{env:weather}}' });
  ok(r2.ok, 'G10 预览通过');
  s2.setEnv('weather', '暴雨');
  const c2 = s2.commit();
  ok(!c2.ok && c2.code === 'env-drift', 'G11 执行前外部值变了 → 拒绝提交', c2.code);
  s2.begin('重新预览', { seed: 1, env: { weather: '暴雨', temperature: '21' } });
  s2.dispatch({ id: 'g5', kind: 'set', path: 'tripLog.note', value: '今天{{env:weather}}' });
  const c3 = s2.commit();
  ok(c3.ok && s2.state().tripLog.note === '今天暴雨', 'G12 基于新外部值重新预览后可提交', c3);
  const { r: r4 } = run({ id: 'g6', kind: 'set', path: 'tripLog.note', value: '缺的{{env:nodata}}' });
  ok(r4.ok && r4.changes[0].after === '缺的' && r4.notes.some((n) => n.code === 'env-missing'), 'G13 不存在的外部值写空并告警', r4.notes);
  const { r: r5 } = run({ id: 'g7', kind: 'set', path: 'tripLog.note', value: '未知{{whatever}}' });
  ok(r5.ok && r5.changes[0].after.includes('{{whatever}}') && r5.notes.some((n) => n.code === 'token-unknown'), 'G14 不认识的令牌按原文保留并提示', r5.changes);
}
{
  const s = sb();
  s.begin('预览后偷改', { seed: 1 });
  s.dispatch({ id: 'ok1', kind: 'set', path: 'docs.a1.title', value: '合法' });
  ok(s.dryRun().ok, 'G15 预览时是干净的');
  s.dispatch({ id: 'bad1', kind: 'set', path: 'settings.theme', value: 'neon' });
  const c = s.commit();
  ok(!c.ok && c.code === 'blocked', 'G16 预览后又塞坏指令 → 提交拒绝', c.code);
  eq(s.state(), clone(world), 'G17 被拒时状态一点没动');
}

/* ================================================================ H 事务模式 */

group('H 原子与宽松：坏指令怎么连累好指令');
{
  const ops = [
    { id: 'h1', kind: 'set', path: 'docs.a1.title', value: '好的改动' },
    { id: 'h2', kind: 'set', path: 'settings.theme', value: 'neon' },
    { id: 'h3', kind: 'set', path: 'docs.a2.title', value: '也被牵连了' },
  ];
  const { s, r } = run(ops);
  ok(!r.ok && r.aborted && r.applied === 1 && r.skipped === 1, 'H1 原子模式：撞坏一条就中止', { ok: r.ok, applied: r.applied, skipped: r.skipped });
  eq(r.result, clone(world), 'H2 原子模式的预览结果就是原状态（不给你看半截世界）');
  ok(!s.commit().ok && s.commit().code === 'blocked', 'H3 原子模式提交被拒');
  const { s: s2, r: r2 } = run(ops, { mode: 'lenient' });
  ok(r2.applied === 2 && r2.skipped === 1, 'H4 宽松模式：跳过坏条继续算', { applied: r2.applied, skipped: r2.skipped });
  ok(r2.failed[0].code === 'bad-value' && r2.failed[0].opId === 'h2', 'H5 坏条记录 opId 与原因', r2.failed);
  ok(!r2.ok, 'H6 有跳过就不算「干净通过」');
  const c2 = s2.commit();
  ok(!c2.ok && c2.code === 'blocked' && c2.partial === true, 'H7 部分执行要显式接受，默认仍拒绝', c2.code);
  const { s: s3 } = run(ops, { mode: 'lenient' });
  const c3 = s3.commit({ acceptPartial: true });
  ok(c3.ok && c3.partial && c3.failed.length === 1, 'H8 acceptPartial 只提交好条', c3);
  ok(s3.state().docs.a1.title === '好的改动' && s3.state().docs.a2.title === '也被牵连了' && s3.state().settings.theme === 'auto', 'H9 好条落地、坏条没落地', s3.state().settings);
  ok(s3.journal()[1].label.includes('部分执行'), 'H10 流水里写明这是部分执行', s3.journal());
  ok(s3.revert().ok, 'H11 部分执行的版本也能整版回退');
  eq(s3.state(), clone(world), 'H12 回退后连好条一起复原');
}
{
  const { s, r } = run([{ id: 'a', kind: 'set', path: 'settings.theme', value: 'dark' }, { id: 'b', kind: 'set', path: 'docs.aX.title', value: 'x' }], { mode: 'lenient' });
  ok(r.applied === 1 && r.skipped === 1, 'H13 全批只有一条好也算部分', { applied: r.applied, skipped: r.skipped });
  const c = s.commit({ acceptPartial: true });
  ok(c.ok && c.changed === 1 && c.partial, 'H14 提交只算好条的改动数', c);
  const { s: s2, r: r2 } = run([{ id: 'a', kind: 'set', path: 'docs.aX.title', value: 'x' }, { id: 'b', kind: 'set', path: 'docs.aY.body', value: 'y' }], { mode: 'lenient' });
  ok(r2.applied === 0 && !r2.ok, 'H15 全坏批次 applied 为 0', { applied: r2.applied });
  const c2 = s2.commit({ acceptPartial: true });
  ok(!c2.ok && c2.code === 'blocked', 'H16 全坏批次即使 acceptPartial 也不提交', c2.code);
  eq(s2.state(), clone(world), 'H17 全坏批次状态不动');
}

/* ================================================================ I 副作用 */

group('I 副作用：预览不外发、不可逆要单独对待');
{
  const s = sb();
  s.begin('副作用', { seed: 1 });
  s.dispatchAll([
    { id: 'e1', kind: 'set', path: 'docs.a1.title', value: '带副作用的改动' },
    { id: 'e2', kind: 'effect', name: 'notify', args: { to: '{{env:weather}}', when: '{{now}}' } },
  ]);
  const r = s.dryRun();
  ok(r.ok, 'I1 副作用指令可通过预览', r.problems);
  ok(s.sink.length === 0, 'I2 预览阶段一个字节都没外发', s.sink);
  ok(r.effects.length === 1 && r.effects[0].name === 'notify', 'I3 预览只登记副作用', r.effects);
  const c = s.commit();
  ok(c.ok && c.effects === 1, 'I4 提交时才外发', c);
  ok(s.sink.length === 1 && s.sink[0].type === 'flush', 'I5 sink 收到 flush 记录', s.sink);
  const rev = s.revert();
  ok(rev.ok, 'I6 有补偿的副作用允许回退');
  ok(s.sink.some((x) => x.type === 'compensate' && x.name === 'cancel-notify'), 'I7 回退发出补偿动作', s.sink);
}
{
  const s = sb();
  s.begin('不可逆', { seed: 1 });
  s.dispatch({ id: 'e3', kind: 'effect', name: 'push-sms', args: { text: '已通知本人' } });
  const c = s.commit();
  ok(c.ok && c.version === 1, 'I8 纯副作用批次也成版（否则无法归属与补偿）', c);
  const rev = s.revert();
  ok(!rev.ok && rev.code === 'irreversible', 'I9 含不可逆副作用的版本默认拒绝回退', rev.code);
  ok(rev.msg.includes('push-sms'), 'I10 拒绝理由点名是哪个副作用', rev.msg);
  const rev2 = s.revert({ force: true });
  ok(rev2.ok, 'I11 force:true 才允许强行回退', rev2);
  ok(s.sink.filter((x) => x.type === 'manual').length === 1, 'I12 不可逆项转成人工处理记录', s.sink);
}
{
  const { r } = run({ id: 'e4', kind: 'effect', name: 'launch-rocket', args: {} });
  ok(has(r, 'unknown-effect'), 'I13 没登记过的副作用直接拒', codes(r));
  ok(first(r, 'unknown-effect').fix.includes('effects'), 'I14 提示去登记');
  ok(has(run({ id: 'e5', kind: 'effect', args: {} }).r, 'unknown-effect'), 'I15 缺 name 的 effect 也拒');
  const { s } = run({ id: 'e6', kind: 'effect', name: 'export-zip', args: {} });
  s.commit();
  const rev = s.revert();
  ok(rev.ok && s.sink.some((x) => x.type === 'withdraw'), 'I16 无补偿副作用回退时发 withdraw', s.sink);
  const s2 = sb();
  ok(s2.registerEffect('secrets', { irreversible: true }).ok === false, 'I17 受保护的名字不能登记为副作用');
  s2.registerEffect('mail', { compensate: 'unmail' });
  s2.begin('新登记', { seed: 1 });
  s2.dispatch({ id: 'e7', kind: 'effect', name: 'mail', args: {} });
  ok(s2.dryRun().ok && s2.effects().some((x) => x.name === 'mail'), 'I18 运行时登记新副作用可用', s2.effects());
}

/* ================================================================ J create / rename */

group('J 新建实体与改名');
{
  const good = { id: 'c1', kind: 'create', at: 'docs', value: { title: '看展记录', body: '人不多，适合聊天。', tags: ['展览'], color: '#8899aa', updatedAt: '2026-10-01', pinned: false } };
  const { s, r } = run(good);
  ok(r.ok, 'J1 合法新建通过', r.problems);
  const c = s.commit();
  const id = Object.keys(s.state().docs).find((k) => s.state().docs[k].title === '看展记录');
  ok(c.ok && !!id, 'J2 实体落进集合', id);
  ok(s.state().docs[id].id === id, 'J3 自动补的 id 与键一致', s.state().docs[id]);
  const rev = s.revert();
  ok(rev.ok && Object.keys(s.state().docs).length === 3, 'J4 回退删掉新建实体', s.state().docs);
  eq(s.state(), clone(world), 'J5 回退后与初始一致');
  ok(has(run(Object.assign({}, good, { id: 'c2', id2: 'a1' })).r, 'dup-id'), 'J6 id2 撞车 → dup-id');
  ok(has(run({ id: 'c3', kind: 'create', at: 'docs', value: { title: 12345, body: '', tags: [], color: '#8899aa', updatedAt: '2026-10-01', pinned: false } }).r, 'bad-value'), 'J7 新建实体字段类型错 → bad-value');
  ok(has(run({ id: 'c4', kind: 'create', at: 'docs', value: { title: '带私货', nickname: '小明' } }).r, 'unknown-path'), 'J8 新建未声明字段 strict 拒绝');
  const { r: r5 } = run({ id: 'c4', kind: 'create', at: 'docs', value: { title: '带私货', nickname: '小明' } }, { policy: { unknownPath: 'open' } });
  ok(r5.ok && r5.notes.some((n) => n.code === 'open-create'), 'J9 open 策略放行但留痕', r5.notes);
  ok(has(run(good, { policy: { allowCreateEntity: false } }).r, 'policy'), 'J10 策略关闭后禁止新建');
  ok(has(run({ id: 'c5', kind: 'create', at: 'nothing.here', value: { a: 1 } }).r, 'unknown-path'), 'J11 没有 entity 声明的集合不能建');
  ok(has(run({ id: 'c6', kind: 'create', at: 'docs', value: { id: 'x__y', title: '怪 id' } }).r, 'bad-value'), 'J12 含双下划线的 id 被拦');
  const o9 = run({ id: 'c7', kind: 'create', at: 'tripLog.days', value: { date: '2026-05-20', title: '野餐', docIds: ['a1'] } });
  ok(o9.r.ok, 'J13 数组集合也能建（追加）', o9.r.problems);
  const s9 = o9.s;
  const c9 = s9.commit();
  ok(c9.ok && s9.state().tripLog.days.length === 3, 'J14 数组追加生效', s9.state().tripLog.days.length);
  ok(!('id' in s9.state().tripLog.days[2]), 'J15 数组记录不被强塞 id', s9.state().tripLog.days[2]);
  ok(s9.revert().ok && s9.state().tripLog.days.length === 2, 'J16 数组追加可回退');
  ok(has(run({ id: 'c8', kind: 'create', at: 'tripLog.days', value: { date: '2026-05-20', title: '野餐', docIds: ['a1', 'zz'] } }).r, 'bad-ref'), 'J17 新建时的引用同样要过 ref 检查');
}
{
  const { s, r } = run({ id: 'rn1', kind: 'rename', path: 'docs.a1', to: 'draft_a1' });
  ok(r.ok, 'R1 实体改键名通过', r.problems);
  ok(r.changes.some((c) => c.kind === 'add') && r.changes.some((c) => c.kind === 'del'), 'R2 预览里表现为旧键删、新键增', r.changes);
  const c = s.commit();
  ok(c.ok && s.state().docs.draft_a1 && !s.state().docs.a1, 'R3 改键落地', Object.keys(s.state().docs));
  ok(s.state().docs.draft_a1.id === 'a1', 'R4 改键名不动实体内的 id', s.state().docs.draft_a1);
  const rev = s.revert();
  ok(rev.ok, 'R5 改键可回退', rev);
  eq(s.state(), clone(world), 'R6 回退后键名复原（键序差异按数据等价判定）');
  ok(has(run({ id: 'rn2', kind: 'rename', path: 'docs.a1', to: 'a2' }).r, 'dup-id'), 'R7 改成已存在的名字 → dup-id');
  ok(has(run({ id: 'rn3', kind: 'rename', path: 'docs.aX', to: 'a9' }).r, 'no-target'), 'R8 改不存在的名 → no-target');
  [['', 'bad-value'], ['a.b', 'protected'], ['__proto__', 'protected'], [12, 'bad-value'], [{}, 'bad-value']].forEach(([to, code]) => {
    const { r } = run({ id: 'rn4', kind: 'rename', path: 'docs.a1', to });
    ok(has(r, code), 'R9 非法新名 ' + truncate(JSON.stringify(to), 12) + ' → ' + code, codes(r));
  });
  ok(has(run({ id: 'rn5', kind: 'rename', path: 'secrets.token', to: 'x' }).r, 'protected'), 'R10 保护区不能改名');
}

/* ================================================================ K 回退账本 */

group('K 回退：回退链与双轨自检');
{
  const s = sb();
  const steps = [
    [{ id: 'k1', kind: 'set', path: 'docs.a1.title', value: '第一篇改名' }],
    [{ id: 'k2', kind: 'create', at: 'docs', value: { title: '新增的一篇', body: '正文', tags: [], color: '#000000', updatedAt: '2026-10-01', pinned: false }, id2: 'k_doc' }],
    [{ id: 'k3', kind: 'delete', path: 'docs.a3', cascade: true }],
    [{ id: 'k4', kind: 'insert', path: 'tripLog.days', value: { date: '2026-10-05', title: '加班', docIds: ['a1'] } }],
    [{ id: 'k5', kind: 'reorder', path: 'tripLog.days', from: 0, to: 2 }],
    [{ id: 'k6', kind: 'rename', path: 'docs.a2', to: 'b2' }],
    [{ id: 'k7', kind: 'effect', name: 'sync-calendar', args: { day: '2026-10-05' } }],
    [{ id: 'k8', kind: 'delete', path: 'tripLog.note' }, { id: 'k9', kind: 'set', path: 'settings.theme', value: 'dark' }],
  ];
  const hashes = [H(clone(world))];
  steps.forEach((ops, i) => {
    s.begin('第 ' + (i + 1) + ' 批', { seed: i + 1 });
    s.dispatchAll(ops);
    const c = s.commit();
    ok(c.ok, 'K1.' + (i + 1) + ' 混合操作批次提交成功', c.code || c.msg);
    hashes.push(H(s.state()));
  });
  ok(s.head().seq === steps.length, 'K2 版本数与批次数一致', s.head().seq);
  const notLifo = s.revert({ seq: 2 });
  ok(!notLifo.ok && notLifo.code === 'not-lifo', 'K3 只能退最近一次执行 → not-lifo', notLifo.code);
  let mismatch = 0;
  for (let i = steps.length; i >= 1; i--) {
    const rev = s.revert({ seq: i });
    if (rev.code === 'undo-mismatch') mismatch++;
    ok(rev.ok, 'K4.' + i + ' 逐版回退不被双轨自检拦下', rev.code || rev.msg);
    ok(H(s.state()) === hashes[i - 1], 'K5.' + i + ' 回退后状态精确落在上一版', { now: H(s.state()).slice(0, 30), want: hashes[i - 1].slice(0, 30) });
  }
  ok(mismatch === 0, 'K6 全程未触发 undo-mismatch（内核账本自洽）', mismatch);
  eq(s.state(), clone(world), 'K7 八批混合操作全部回退后与初始一致');
  ok(s.journal().filter((v) => v.kind === 'revert').length === steps.length, 'K8 流水里回退是追加记录', s.journal().map((v) => v.kind));
  ok(s.revert({ seq: 4 }).code === 'already-reverted', 'K8b 重复回退同一版被拒', s.revert({ seq: 4 }).code);
  const oldestRevert = s.journal().filter((v) => v.kind === 'revert')[0].seq;
  ok(s.revert({ seq: oldestRevert }).code === 'not-lifo', 'K8c 回退记录也不能乱序重做', s.revert({ seq: oldestRevert }).code);
  const lastRevertSeq = s.journal().filter((v) => v.kind === 'revert').pop().seq;
  const re = s.revert({ seq: lastRevertSeq });
  ok(re.ok && re.redo === true && s.journal().slice(-1)[0].kind === 'redo', 'K9 显式回退一条回退记录 = 重做那一版', re);
  ok(s.state().docs.a1.title === '第一篇改名', 'K10 重做把第一批的改动又放回来了', s.state().docs.a1.title);
  ok(s.revert({ seq: 3 }).code === 'already-reverted', 'K10b 已回退过的版本不能重复回退', s.revert({ seq: 3 }).code);
  let guard = 0;
  while (s.lastApplied() && guard++ < 40) { if (!s.revert().ok) break; }
  ok(guard <= 9, 'K11 回退链能一路拆到底，不会打摆子', guard);
  eq(s.state(), clone(world), 'K11b 拆到底后回到初始状态');
  ok(s.lastApplied() === null, 'K11c 没有未回退的执行时 lastApplied 为空');
}

/* ================================================================ L 纯函数工具 */

group('L 结构工具：预览与 diff 靠它们');
{
  ok(matchPattern(parsePath('docs.*.title'), ['docs', 'a1', 'title']), 'L1 * 匹配一段');
  ok(!matchPattern(parsePath('docs.*.title'), ['docs', 'a1']), 'L2 段数不足不匹配');
  ok(matchPattern(parsePath('tripLog.**'), ['tripLog']), 'L3 ** 可匹配零段');
  ok(matchPattern(parsePath('tripLog.**'), ['tripLog', 'days', '0', 'docIds', '1']), 'L4 ** 匹配任意深度');
  ok(ruleFor(schema, ['docs', 'a1', 'color']).type === 'hex', 'L5 取最长匹配规则');
  ok(ruleFor(schema, ['docs', 'a1', 'mood']) === null, 'L6 未声明字段无规则（strict 据此拒绝）');
  const lf = leaves({ a: 1, b: { c: [2, 3] } });
  ok(lf.length === 3 && lf.map((x) => joinPath(x.segs)).join(',') === 'a,b.c.0,b.c.1', 'L7 值摊成叶子路径', lf.map((x) => joinPath(x.segs)));
  ok(leaves([])[0].value.length === 0 && Object.keys(leaves({})[0].value).length === 0, 'L8 空数组/空对象也算一个叶子');
  const d = diffTrees(world, Object.assign(clone(world), { docs: Object.assign(clone(world.docs), { a1: Object.assign(clone(world.docs.a1), { title: '改了', mood: '不错' }) }) }));
  ok(d.some((x) => x.kind === 'mod' && x.path === 'docs.a1.title') && d.some((x) => x.kind === 'add' && x.path === 'docs.a1.mood'), 'L9 diffTrees 分增改', d);
  ok(classify([{ path: 'a', kind: 'mod' }, { path: 'a', kind: 'mod' }, { path: 'b', kind: 'add' }]).length === 2, 'L10 classify 去重');
  const tk = resolveTokens('x{{now}}', undefined, 'p');
  ok(tk.value === 'x' && tk.notes.length === 1, 'L11 无上下文解析令牌不抛错', tk);
  ok(bytes({ a: 1 }) === 7 && bytes(undefined) === 0, 'L12 字节估计可用', bytes({ a: 1 }));
  ok(getAt(world, ['docs', 'a1', 'tags', '0']) === '徒步', 'L13 数字段可读数组');
  ok(getAt(world, ['docs', 'a1', 'title', 'x']) === undefined, 'L14 穿过字符串不再往下钻');
  ok(truncate('abcdefghij', 4) === 'abcd…', 'L15 truncate 保护显示宽度');
  ok(PROTECTED_SEGMENTS.includes('secrets') && FORBIDDEN_KINDS.includes('script') && OP_KINDS.includes('reorder'), 'L16 常量表可对外引用');
  ok(sameState({ a: 1, b: 2 }, { b: 2, a: 1 }) && !sameState({ a: 1 }, { a: 2 }), 'L17 sameState 忽略键序但不忽略值');
}

/* ================================================================ M 真实场景串烧 */

group('M 串烧：一轮 AI 乱改之后');
{
  const s = sb({ env: { date: '2026-10-27' } });
  const dirty = [
    { id: '1', kind: 'set', path: 'docs.a1.title', value: '西湖徒步路线笔记（修订）', expect: '西湖徒步路线笔记' },
    { id: '2', kind: 'set', path: 'docs.a1.color', value: 'not-a-color' },
    { id: '3', kind: 'delete', path: 'docs.a3' },
    { id: '4', kind: 'create', at: 'docs', value: { title: '补写：雨天的安排', body: '改室内。', tags: ['备选'], color: '#445566', updatedAt: '{{env:date}}', pinned: false } },
    { id: '5', kind: 'set', path: 'secrets.token', value: 'sk-stolen' },
    { id: '6', kind: 'script', code: 'alert(1)' },
    { id: '7', kind: 'effect', name: 'notify', args: { text: '已完成 {{now}}' } },
    { id: '8', kind: 'bulk', ops: [
      { kind: 'set', path: 'tripLog.days.0.docIds', value: ['a1', 'a3'] },
      { kind: 'set', path: 'tripLog.note', value: '两天，三个地方。（{{env:weather}}）' },
    ] },
  ];
  const env = { weather: '晴', temperature: '21', date: '2026-10-27' };
  s.begin('AI 的一批乱改', { seed: 7, env, clockISO: '2026-10-27T00:00:00.000Z' });
  s.dispatchAll(dirty);
  const r = s.dryRun();
  ok(!r.ok && r.aborted, 'M1 原子模式：整批不过', { ok: r.ok, aborted: r.aborted });
  ok(r.problems.length === 1, 'M2 只报第一个致命问题', r.problems);
  ok(['bad-value', 'dangling', 'protected', 'not-declarative'].includes(r.problems[0].code), 'M3 致命问题是预期类别之一', r.problems[0].code);
  ok(!s.commit({ acceptPartial: true }).ok, 'M4 原子批次不接受部分提交');
  s.begin('拆开重来', { seed: 8, mode: 'lenient', env, clockISO: '2026-10-27T00:00:00.000Z' });
  s.dispatchAll(dirty);
  const r2 = s.dryRun();
  ok(r2.ops === 9 && r2.mode === 'lenient' && r2.skipped === 4 && r2.applied === 5, 'M5 宽松模式：8 项展开成 9 条，5 好 4 坏', { ops: r2.ops, applied: r2.applied, skipped: r2.skipped });
  const kinds = Array.from(new Set(r2.failed.map((f) => f.code))).sort();
  ok(kinds.includes('bad-value') && kinds.includes('dangling') && kinds.includes('protected') && kinds.includes('not-declarative'), 'M6 四类破坏各有专属错误码', kinds);
  const c = s.commit({ acceptPartial: true });
  ok(c.ok, 'M7 好条部分提交', c);
  ok(s.state().secrets.token === 'sk-live-abcdef', 'M8 密钥没被改动');
  ok(s.state().docs.a3 !== undefined, 'M9 被引用实体没被删');
  ok(s.state().docs.a1.title.includes('修订'), 'M10 合法改动落地');
  ok(s.sink.length === 1 && s.sink[0].args.text.includes('2026-10-27T00:00:00.000Z'), 'M11 副作用带着冻结时钟外发', s.sink);
  const rev = s.revert();
  ok(rev.ok, 'M12 部分提交可回退', rev.code);
  eq(s.state(), clone(world), 'M13 回退后世界完整复原');
}

/* ---------------------------------------------------------------- 结论 */

console.log('\n────────────────────────────────');
console.log('断言：' + pass + ' 通过 / ' + fail + ' 失败，合计 ' + (pass + fail));
if (fail) {
  console.log('失败清单：');
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('沙盒内核自检全绿。');
