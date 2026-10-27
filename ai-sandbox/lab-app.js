/*
 * 沙盒实验台 UI · 与 core.mjs 一起被 build-lab.mjs 内联成 ai-sandbox/lab.html
 *
 * 这里只负责「把 AI 递来的指令摆出来，让你按预览/执行/回退/放弃四个钮」，
 * 判定全在 core.mjs。SAMPLE 是示例世界 + schema + 副作用登记 + 指令池。
 */

/* ------------------------------------------------------------------ 示例数据 */

const SAMPLE = {
  clockISO: '2026-10-27T09:12:00.000Z',
  env: { weather: '晴', temperature: '21', date: '2026-10-27' },
  world: {
    docs: {
      a1: { id: 'a1', title: '西湖徒步路线笔记', body: '从北山街出发，经过断桥、白堤到孤山，全程两小时。', tags: ['徒步', '西湖'], color: '#2f6f5e', updatedAt: '2026-05-01', pinned: false },
      a2: { id: 'a2', title: '第一次见面的餐厅记录', body: '门口有盏黄灯，靠窗的位子安静，她点了墨鱼汁面。', tags: ['餐厅'], color: '#b3543a', updatedAt: '2026-05-06', pinned: true },
      a3: { id: 'a3', title: '关于拍照的三条经验', body: '一是逆光别硬拍，二是随手记时间，三是记得带充电宝。', tags: ['拍照'], color: '#3a5fb3', updatedAt: '2026-05-09', pinned: false },
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
  },
  schema: [
    { path: 'docs', entity: {
      id: { type: 'string' },
      title: { type: 'string', min: 1, max: 40 },
      body: { type: 'string', max: 2000 },
      tags: { type: 'array', items: 'string', maxItems: 6 },
      color: { type: 'hex' },
      updatedAt: { type: 'date' },
      pinned: { type: 'boolean' },
      mood: { type: 'string', max: 12 },
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
    } },
    { path: 'tripLog.days.*.date', type: 'date' },
    { path: 'tripLog.days.*.title', type: 'string', max: 30 },
    { path: 'tripLog.days.*.docIds', ref: 'docs', type: 'array', items: 'string', maxItems: 10 },
    { path: 'tripLog.days.*.mood', type: 'string', max: 60 },
    { path: 'tripLog.note', type: 'string', max: 120 },
    { path: 'settings.fontSize', type: 'number', min: 12, max: 28 },
    { path: 'settings.theme', type: 'string', enum: ['auto', 'light', 'dark'] },
    { path: 'settings.*', type: 'any' },
  ],
  effects: {
    notify: { describe: '给ta发一条提醒', compensate: 'cancel-notify' },
    'sync-calendar': { describe: '写进系统日历', compensate: 'remove-calendar' },
    'push-sms': { describe: '发短信（发出去就收不回）', irreversible: true },
  },
  /* 指令池：前 6 条正常，后 8 条是各种「AI 可能干出来的事」 */
  pool: [
    { id: 'p1', risk: '正常', say: '把西湖那篇的标题加上「（修订）」', op: { kind: 'set', path: 'docs.a1.title', value: '西湖徒步路线笔记（修订）' } },
    { id: 'p2', risk: '正常', say: '给餐厅记录补一个标签「初次」', op: { kind: 'insert', path: 'docs.a2.tags', value: '初次' } },
    { id: 'p3', risk: '正常', say: '置顶拍照经验', op: { kind: 'set', path: 'docs.a3.pinned', value: true } },
    { id: 'p4', risk: '正常', say: '新建一篇「雨天备选方案」', op: { kind: 'create', at: 'docs', value: { title: '雨天备选方案', body: '改博物馆 + 咖啡馆。', tags: ['备选'], color: '#445566', updatedAt: '2026-10-27', pinned: false } } },
    { id: 'p5', risk: '正常', say: '把行程第二天挪到最前面', op: { kind: 'reorder', path: 'tripLog.days', from: 1, to: 0 } },
    { id: 'p6', risk: '正常', say: '把总备注里的天气写成当天的实际天气', op: { kind: 'set', path: 'tripLog.note', value: '两天，三个地方，{{env:weather}}天。' } },
    { id: 'p7', risk: '正常', say: '给新文章盖时间戳', op: { kind: 'set', path: 'tripLog.days.0.mood', value: '建于 {{now}}' } },
    { id: 'x1', risk: '危险', say: '把主题色改成 not-a-color', op: { kind: 'set', path: 'docs.a1.color', value: 'not-a-color' } },
    { id: 'x2', risk: '危险', say: '字号放大到 999', op: { kind: 'set', path: 'settings.fontSize', value: 999 } },
    { id: 'x3', risk: '危险', say: '删掉拍照那篇（它正被行程引用）', op: { kind: 'delete', path: 'docs.a3' } },
    { id: 'x4', risk: '危险', say: '行程第一天引用一篇不存在的文章', op: { kind: 'set', path: 'tripLog.days.0.docIds', value: ['a1', 'a9'] } },
    { id: 'x5', risk: '越权', say: '读出密钥并写进文章', op: { kind: 'set', path: 'docs.a1.body', value: '密钥是 sk-live-abcdef' } },
    { id: 'x6', risk: '越权', say: '直接改 secrets.token', op: { kind: 'set', path: 'secrets.token', value: 'sk-stolen' } },
    { id: 'x7', risk: '越权', say: '改沙盒自己的账本', op: { kind: 'set', path: 'ledger.balance', value: 0 } },
    { id: 'x8', risk: '注入', say: '塞一段脚本进去执行', op: { kind: 'script', code: 'alert(document.cookie)' } },
    { id: 'x9', risk: '注入', say: '用原型污染改 Object.prototype', op: JSON.parse('{"kind":"set","path":"settings.theme","value":"dark","__proto__":{"polluted":1}}') },
    { id: 'x10', risk: '超大', say: '一次性写入 20 万字的正文', op: { kind: 'set', path: 'docs.a1.body', value: '一'.repeat(60000) } },
    { id: 'x11', risk: '越权', say: '改一个 schema 里没写的字段', op: { kind: 'set', path: 'docs.a1.nickname', value: '小可爱' } },
    { id: 'x12', risk: '注入', say: '用批量指令一次改 300 个字段', op: { kind: 'bulk', ops: Array.from({ length: 300 }, (_v, i) => ({ kind: 'set', path: 'tripLog.days.0.docIds', value: ['a1'] })) } },
    { id: 'x13', risk: '过期', say: '基于旧标题改名（前值已被别的批次改过）', op: { kind: 'set', path: 'docs.a1.title', value: '覆盖别人的改动', expect: '西湖徒步路线笔记' } },
    { id: 'x14', risk: '不可逆', say: '执行时给 ta 发一条短信', op: { kind: 'effect', name: 'push-sms', args: { text: '我们这周六去西湖吧' } } },
    { id: 'x15', risk: '正常', say: '执行时提醒 ta（可补偿）', op: { kind: 'effect', name: 'notify', args: { text: '行程已更新' } } },
  ],
};

/* ------------------------------------------------------------------ 界面 */

const UI = {
  picked: new Set(['p1', 'p2', 'x1', 'x3', 'x5', 'x8']),
  batch: null,     // 当前草稿批 {name, ids, mode, seed, clockISO}
  last: null,      // 最近一次 dryRun 结果
};

let sb = null;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const show = (v) => (typeof v === 'string' ? JSON.stringify(v.length > 60 ? v.slice(0, 60) + '…' : v) : JSON.stringify(v));
const hashOf = (o) => { const s = JSON.stringify(canon(o)); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };

function newSandbox() {
  sb = createSandbox({
    world: clone(SAMPLE.world),
    schema: clone(SAMPLE.schema),
    effects: clone(SAMPLE.effects),
    env: clone(SAMPLE.env),
    at: 'T0',
  });
  applyPolicyFromUI();
  UI.last = null;
  UI.batch = null;
}

function applyPolicyFromUI() {
  if (!sb) return;
  sb.policy.unknownPath = $('polUnknown').value;
  sb.policy.maxOps = Number($('polOps').value);
  sb.policy.maxBytes = Number($('polBytes').value);
  sb.policy.maxChanges = Number($('polChanges').value);
}

const poolById = (id) => SAMPLE.pool.find((p) => p.id === id);

function renderState() {
  const st = sb.state();
  $('docs').innerHTML = Object.keys(st.docs).map((k) => {
    const d = st.docs[k];
    return '<div class="doc" style="border-left-color:' + esc(d.color) + '">'
      + '<div class="dt">' + esc(d.title) + (d.pinned ? '<span class="pin">置顶</span>' : '') + '</div>'
      + '<div class="dm">' + esc(k) + ' · ' + (d.tags || []).join('/') + ' · ' + esc(d.updatedAt || '') + '</div>'
      + '<div class="db">' + esc(String(d.body || '').slice(0, 46)) + '</div></div>';
  }).join('');
  $('days').innerHTML = st.tripLog.days.map((d, i) => '<div class="day"><b>D' + (i + 1) + '</b> ' + esc(d.date) + ' ' + esc(d.title)
    + ' <span class="ref">' + (d.docIds || []).map((x) => '→' + esc(x)).join(' ') + '</span></div>').join('');
  $('note').textContent = st.tripLog.note || '（备注已删）';
  $('set').textContent = '主题 ' + st.settings.theme + ' · 字号 ' + st.settings.fontSize;
  $('guarded').textContent = 'token=' + st.secrets.token + ' · balance=' + st.ledger.balance;
  $('stateHash').textContent = hashOf(st);
  $('docCount').textContent = Object.keys(st.docs).length;
  $('snapCount').textContent = sb.head().seq;
  $('poolCount').textContent = SAMPLE.pool.length;
  document.body.dataset.stateHash = hashOf(st);
  document.body.dataset.sbVersion = sb.head().seq;
}

function renderPool() {
  const used = UI.batch ? new Set(UI.batch.ids) : null;
  $('pool').innerHTML = SAMPLE.pool.map((p) => {
    const inBatch = used && used.has(p.id);
    return '<label class="op risk-' + p.risk + (inBatch ? ' used' : '') + '">'
      + '<input type="checkbox" data-op="' + p.id + '"' + (UI.picked.has(p.id) ? ' checked' : '') + (inBatch ? ' disabled' : '') + '>'
      + '<span class="tag">' + p.risk + '</span><span class="say">' + esc(p.say) + '</span>'
      + '<span class="raw">' + esc(truncate(JSON.stringify(p.op), 150)) + '</span></label>';
  }).join('');
}

function renderBatch() {
  const b = UI.batch;
  $('batchName').textContent = b ? b.name : '（没有进行中的批次）';
  $('batchOps').textContent = b ? b.ids.length + ' 条' : '';
  $('batchMode').textContent = b ? b.mode : '';
  $('bPreview').disabled = !b;
  $('bExecute').disabled = !b;
  $('bDiscard').disabled = !b;
  $('bRevert').disabled = !sb.lastApplied();
  document.body.dataset.sbActive = b ? b.name : '';
  document.body.dataset.sbDraft = b ? b.ids.length : 0;
  document.body.dataset.sbMode = b ? b.mode : '';
}

function renderJournal() {
  const j = sb.journal();
  $('journal').innerHTML = j.map((v) => '<div class="jv' + (v.reverted ? ' dead' : '') + '"><b>#' + v.seq + '</b> '
    + '<span class="jk">' + v.kind + '</span> ' + esc(v.label)
    + '<span class="jm">' + (v.changed || 0) + ' 处' + (v.effects ? ' · ' + v.effects + ' 副作用' : '') + (v.reverted ? ' · 已回退' : '') + '</span></div>').join('');
  document.body.dataset.sbSnaps = j.length;
  document.body.dataset.journal = j.map((v) => v.seq + ':' + v.kind + (v.reverted ? '!' : '')).join(',');
}

function renderSink() {
  $('sink').innerHTML = sb.sink.length ? sb.sink.map((e) => '<div class="sk">' + esc(e.type) + ' · ' + esc(e.name) + ' <span class="jm">' + esc(truncate(JSON.stringify(e.args), 60)) + '</span></div>').join('')
    : '<div class="empty">预览不会外发，这里一直是空的。执行后才有记录。</div>';
  document.body.dataset.sinkCount = sb.sink.length;
}

function kindClass(k) { return k === 'add' ? 'add' : k === 'del' ? 'del' : 'mod'; }

function renderPreview(res) {
  UI.last = res;
  const ch = res.changes || [];
  const pr = res.problems || [];
  const fl = res.failed || [];
  const nt = res.notes || [];
  $('pvSummary').innerHTML = '<b>' + (res.ok ? '整批可通过' : (res.mode === 'lenient' ? '宽松：' + res.applied + ' 条可过，' + res.skipped + ' 条被跳过' : '整批不放行')) + '</b>'
    + '<span class="jm">' + res.ops + ' 条指令 · ' + ch.length + ' 处改动' + (pr.length ? ' · ' + pr.length + ' 个问题' : '') + '</span>';
  $('pvChanged').textContent = ch.length;
  $('pvSteps').textContent = res.ops;
  $('pvProblems').textContent = pr.length + fl.length;
  $('pvNotes').textContent = nt.length;
  document.body.dataset.pvSteps = res.ops;
  document.body.dataset.pvChanged = ch.length;
  document.body.dataset.pvProblems = pr.length + fl.length;
  document.body.dataset.pvApplied = res.applied;
  document.body.dataset.pvSkipped = res.skipped;

  $('pvChanges').innerHTML = ch.length ? ch.map((c) => '<div class="ch ' + kindClass(c.kind) + '"><span class="ck">' + c.kind + '</span> <code>'
    + esc(c.path) + '</code> ' + (c.kind === 'add' ? '<span class="after">' + esc(show(c.after)) + '</span>'
      : c.kind === 'del' ? '<span class="before">' + esc(show(c.before)) + '</span>'
        : '<span class="before">' + esc(show(c.before)) + '</span> → <span class="after">' + esc(show(c.after)) + '</span>')
    + (c.via ? ' <span class="via">' + esc(c.via) + '</span>' : '') + '</div>').join('')
    : '<div class="empty">没有任何增删改。</div>';

  const allProblems = pr.concat(fl);
  $('pvProblemsList').innerHTML = allProblems.length ? allProblems.map((p) => '<div class="pb"><span class="code">' + esc(p.code) + '</span> '
    + esc(p.msg || '') + (p.fix ? '<div class="fix">怎么改：' + esc(p.fix) + '</div>' : '') + '</div>').join('')
    : '<div class="empty">没有拦截。</div>';

  $('pvNotesList').innerHTML = nt.length ? nt.map((n) => '<div class="nt"><span class="code">' + esc(n.code) + '</span> ' + esc(n.msg || '') + '</div>').join('')
    : '<div class="empty">无提示。</div>';

  $('pvEffects').innerHTML = (res.effects || []).length ? res.effects.map((e) => '<div class="ef">' + esc(e.name) + ' <span class="jm">' + esc(truncate(JSON.stringify(e.args), 70)) + '</span>'
    + (e.irreversible ? '<span class="bad">不可逆</span>' : e.compensate ? '<span class="ok">可补偿 ' + esc(e.compensate) + '</span>' : '<span class="ok">可撤回</span>') + '</div>').join('')
    : '<div class="empty">这批不带副作用。</div>';
  $('panel').hidden = false;
}

function toast(msg, tone) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + (tone || 'info');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ------------------------------------------------------------------ 四个动作 */

function pack() {
  const ids = Array.from(UI.picked);
  if (!ids.length) { toast('先在池子里勾几条指令', 'warn'); return; }
  const n = sb.head().seq + 1;
  const mode = $('polMode').value;
  const seed = $('polSeed').value || String(n);
  sb.begin('批次 #' + n + '（' + ids.length + ' 条）', { seed, mode, clockISO: SAMPLE.clockISO, env: clone(SAMPLE.env) });
  ids.forEach((id) => sb.dispatch(clone(poolById(id).op)));
  UI.batch = { name: '批次 #' + n, ids: ids.slice(), mode, seed };
  UI.picked.clear();
  renderAll();
  toast('已打包为一批，先预览', 'info');
}

function preview() {
  if (!UI.batch) return;
  applyPolicyFromUI();
  renderPreview(sb.dryRun());
}

function execute() {
  if (!UI.batch) return;
  const accept = $('polAcceptPartial').checked;
  const c = sb.commit({ acceptPartial: accept });
  if (!c.ok) {
    const why = c.code === 'env-drift' ? '外部值在执行前变了，请重新打包预览'
      : c.code === 'blocked' ? '被拦：' + (c.partial ? '（部分执行需要勾选「接受部分落地」）' : (c.detail && c.detail.problems && c.detail.problems[0] ? c.detail.problems[0].msg : '有问题未解决'))
        : c.code === 'unstable' ? '两次预览结果不一致，内核不放行' : c.code;
    toast('执行被拒：' + why, 'bad');
    renderPreview(sb.dryRun());
    return;
  }
  if (c.noop) { toast('这批没造成任何变化，没留版本', 'info'); UI.batch = null; renderAll(); return; }
  toast('已执行，生成 #' + c.version + (c.partial ? '（部分落地 ' + c.failed.length + ' 条被跳过）' : ''), 'ok');
  UI.batch = null;
  renderAll();
}

function revertOne() {
  const last = sb.lastApplied();
  if (!last) { toast('没有待回退的执行', 'warn'); return; }
  const r = sb.revert({ seq: last.seq, force: $('polForce').checked });
  if (!r.ok) {
    toast(r.code === 'irreversible' ? '这批含不可逆副作用，回退不了（勾「允许强制回退」并自行处理外部状态）' : r.msg || r.code, 'bad');
    return;
  }
  toast('已回退 #' + last.seq + '，新增 #' + r.version, 'ok');
  renderAll();
}

function discard() {
  if (!UI.batch) return;
  const n = sb.discard();
  UI.batch = null;
  renderAll();
  toast('已放弃这批草稿（' + n + ' 条指令回到池子）', 'info');
}

function renderAll() {
  renderState();
  renderPool();
  renderBatch();
  renderJournal();
  renderSink();
}

/* ------------------------------------------------------------------ 事件 */

document.addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-op]');
  if (!cb) return;
  const id = cb.dataset.op;
  if (cb.checked) UI.picked.add(id); else UI.picked.delete(id);
  renderPool();
});

$('allNormal').addEventListener('click', () => { SAMPLE.pool.forEach((p) => { if (p.risk === '正常') UI.picked.add(p.id); }); renderPool(); });
$('allRisky').addEventListener('click', () => { SAMPLE.pool.forEach((p) => { if (p.risk !== '正常') UI.picked.add(p.id); }); renderPool(); });
$('clearPick').addEventListener('click', () => { UI.picked.clear(); renderPool(); });
$('bPack').addEventListener('click', pack);
$('bPreview').addEventListener('click', preview);
$('bExecute').addEventListener('click', execute);
$('bDiscard').addEventListener('click', discard);
$('bRevert').addEventListener('click', revertOne);
$('reset').addEventListener('click', () => { newSandbox(); renderAll(); $('panel').hidden = true; toast('世界已重置', 'info'); });
['polUnknown', 'polOps', 'polBytes', 'polChanges', 'polMode', 'polSeed'].forEach((id) => $(id).addEventListener('change', () => { applyPolicyFromUI(); if (UI.batch) preview(); }));

/* 测试钩子：Playwright 直接驱动，不依赖点击 */
window.__sb = {
  SAMPLE,
  get sandbox() { return sb; },
  pick(ids) { UI.picked = new Set(ids); renderPool(); },
  pack, preview, execute, revertOne, discard,
  reset: () => { newSandbox(); renderAll(); },
  setPolicy(p) { Object.assign(sb.policy, p); },
  setEnv(k, v) { sb.setEnv(k, v); },
  setMode(m) { $('polMode').value = m; applyPolicyFromUI(); if (UI.batch) preview(); },
  last: () => UI.last,
  state: () => sb.state(),
};

newSandbox();
renderAll();
