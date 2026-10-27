/**
 * 把内核 + 实验台 UI 内联成一个可双击打开的单文件 lab.html
 *
 *   node ai-sandbox/build-lab.mjs
 *
 * 为什么要内联：file:// 协议下 <script type="module"> 会被 CORS 拦住，
 * 而实验台的价值就是「手机上直接打开就能玩」。core.mjs 零依赖、不碰 DOM，
 * 去掉 export 关键字就能当普通脚本用。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), 'utf8');

const core = read('core.mjs').replace(/^export (const|function|async function)\s/gm, '$1 ');
const app = read('lab-app.js');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>沙盒实验台 · AI 指令事务内核</title>
<style>
:root{
  --bg:#0f1115; --card:#171a21; --card2:#1d2129; --line:#272c36; --ink:#e6e8ee; --dim:#9aa3b2;
  --ok:#4cc38a; --warn:#e0a458; --bad:#ef6b6b; --mod:#6ea8fe; --add:#57c98a; --del:#e06c75;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;padding-bottom:76px}
header{position:sticky;top:0;z-index:5;background:linear-gradient(180deg,var(--bg),rgba(15,17,21,.92));backdrop-filter:blur(6px);padding:12px 14px 8px;border-bottom:1px solid var(--line)}
h1{margin:0;font-size:17px;letter-spacing:.5px}
.sub{color:var(--dim);font-size:12px}
main{padding:12px 14px;display:flex;flex-direction:column;gap:12px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:11px 12px}
h2{margin:0 0 8px;font-size:13px;color:var(--dim);font-weight:600;letter-spacing:.4px;display:flex;justify-content:space-between;align-items:center}
h2 .n{color:var(--ink);font-variant-numeric:tabular-nums}
.doc{border-left:3px solid var(--line);padding:3px 0 3px 9px;margin:6px 0;background:var(--card2);border-radius:0 8px 8px 0}
.dt{font-weight:600}.dm{color:var(--dim);font-size:12px}.db{color:#c4cad6;font-size:12.5px}
.pin{margin-left:6px;font-size:11px;color:var(--warn);border:1px solid var(--warn);border-radius:4px;padding:0 4px}
.day{font-size:13px;padding:2px 0}.ref{color:var(--mod)}
.kv{font-size:12.5px;color:var(--dim);display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.kv code{color:var(--ink);background:var(--card2);padding:1px 6px;border-radius:5px;font-size:12px}
.guard{color:var(--bad);font-size:12px}
.op{display:grid;grid-template-columns:auto auto 1fr;gap:6px;align-items:baseline;padding:6px 4px;border-bottom:1px dashed var(--line);font-size:13.5px}
.op:last-child{border-bottom:0}
.op.used{opacity:.35}
.op .raw{grid-column:1/-1;color:#5d6675;font-size:11px;word-break:break-all;font-family:ui-monospace,monospace}
.tag{font-size:10.5px;padding:0 5px;border-radius:4px;border:1px solid var(--line);color:var(--dim)}
.risk-危险 .tag{color:var(--warn);border-color:var(--warn)}
.risk-越权 .tag{color:var(--bad);border-color:var(--bad)}
.risk-注入 .tag{color:#d371d3;border-color:#d371d3}
.risk-超大 .tag,.risk-过期 .tag,.risk-不可逆 .tag{color:#e6b673;border-color:#e6b673}
.ch,.pb,.nt,.ef,.jv,.sk{font-size:12.5px;padding:5px 0;border-bottom:1px dashed var(--line);word-break:break-all}
.ch:last-child,.pb:last-child{border-bottom:0}
.ch code{color:var(--ink);font-size:11.5px;word-break:break-all}
code{word-break:break-all}
.ck{font-weight:700;font-size:11px;padding:0 5px;border-radius:4px}
.add .ck{color:var(--add)}.mod .ck{color:var(--mod)}.del .ck{color:var(--del)}
.before{color:var(--del)}.after{color:var(--add)}.via{color:var(--warn);font-size:11px}
.code{font-size:11px;color:var(--bad);border:1px solid var(--bad);border-radius:4px;padding:0 5px;font-family:ui-monospace,monospace}
.nt .code{color:var(--mod);border-color:var(--mod)}
.ef .code{color:var(--ok);border-color:var(--ok)}
.fix{color:var(--dim);font-size:11.5px;margin-top:2px}
.jv b{color:var(--dim)}.jk{font-size:11px;color:var(--mod)}.jv.dead{opacity:.4;text-decoration:line-through}
.mj,.jm{color:var(--dim);font-size:11.5px}
.empty{color:#5d6675;font-size:12px;padding:4px 0}
.bad{color:var(--bad);font-size:11px;margin-left:6px}.ok{color:var(--ok);font-size:11px;margin-left:6px}
.pol{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;font-size:12px}
.pol label{display:flex;flex-direction:column;gap:3px;color:var(--dim);min-width:0}
.pol select,.pol input{background:var(--card2);color:var(--ink);border:1px solid var(--line);border-radius:7px;padding:5px 6px;font-size:13px;width:100%;min-width:0}
.chk{display:flex;align-items:center;gap:6px;color:var(--dim);font-size:12px;margin-top:6px}
.chk input{width:16px;height:16px}
.bar{position:fixed;bottom:0;left:0;right:0;z-index:6;background:rgba(20,23,29,.97);border-top:1px solid var(--line);padding:8px 10px calc(8px + env(safe-area-inset-bottom));display:flex;gap:7px;align-items:center}
.bar .info{flex:1;font-size:11.5px;color:var(--dim);min-width:0}
button{background:var(--card2);color:var(--ink);border:1px solid var(--line);border-radius:9px;padding:9px 12px;font-size:13.5px}
button:disabled{opacity:.4}
#bPack{border-color:#3b6ef0;color:#9dc0ff}
#bPreview{border-color:#7d5fe0;color:#c3adff}
#bExecute{background:#1c4b34;border-color:#2f7d54;color:#bff0d3}
#bRevert{background:#4d3418;border-color:#8a6224;color:#ffdca8}
#bDiscard{color:var(--bad);border-color:#5c3134}
.mini{display:flex;gap:6px;margin-bottom:8px}
.mini button{padding:5px 9px;font-size:12px}
.toast{position:fixed;left:12px;right:12px;bottom:74px;z-index:9;padding:9px 12px;border-radius:10px;font-size:13px;border:1px solid}
.toast.info{background:#16202e;border-color:#2b4468;color:#bcd7ff}
.toast.ok{background:#122a1e;border-color:#2f7d54;color:#bff0d3}
.toast.warn{background:#2a2314;border-color:#8a6224;color:#ffdca8}
.toast.bad{background:#2c1618;border-color:#a24148;color:#ffc5c9}
.note{color:var(--dim);font-size:11.5px;margin:6px 0 0}
[data-role=guardhint]{color:var(--warn)}
</style>
</head>
<body data-lab="ai-sandbox">
<header>
  <h1>沙盒实验台 · 给「会乱改的 AI」上闸</h1>
  <div class="sub">勾指令 → 打包成批 → 预览 → 执行 / 放弃；执行后可回退。判定全在 core.mjs。</div>
</header>
<main>
  <section>
    <h2>策略 <span class="n" id="polHint"></span></h2>
    <div class="pol">
      <label>事务模式<select id="polMode"><option value="atomic">原子（一条不过整批不进）</option><option value="lenient">宽松（跳过坏条）</option></select></label>
      <label>未声明路径<select id="polUnknown"><option value="strict">strict 拒绝</option><option value="open">open 放行</option></select></label>
      <label>单批指令上限<input id="polOps" type="number" value="200" min="1"></label>
      <label>单条字节上限<input id="polBytes" type="number" value="65536" min="1"></label>
      <label>影响字段上限<input id="polChanges" type="number" value="400" min="1"></label>
      <label>批次种子<input id="polSeed" type="text" value="1"></label>
    </div>
    <div class="chk"><input type="checkbox" id="polAcceptPartial"><label for="polAcceptPartial">执行时接受部分落地（宽松模式才有意义）</label></div>
    <div class="chk"><input type="checkbox" id="polForce"><label for="polForce">回退时允许强制（含不可逆副作用时用）</label></div>
    <div class="note">同一种指令，改这里的开关就能看到不同判定 —— 这就是内核的全部可配置面。</div>
  </section>

  <section>
    <h2>当前世界 <span class="n">hash <span id="stateHash"></span> · <span id="docCount"></span> 篇 · 版本 #<span id="snapCount"></span></span></h2>
    <div id="docs"></div>
    <h2 style="margin-top:10px">行程</h2>
    <div id="days"></div>
    <div class="kv"><span>备注：<code id="note"></code></span><span><code id="set"></code></span></div>
    <div class="kv guard">受保护区（指令改不动）：<span data-role=guardhint id="guarded"></span></div>
  </section>

  <section>
    <h2>指令池 <span class="n">共 <span id="poolCount"></span> 条</span></h2>
    <div class="mini"><button id="allNormal">只勾正常</button><button id="allRisky">只勾危险</button><button id="clearPick">清空</button><button id="reset">重置世界</button></div>
    <div id="pool"></div>
  </section>

  <section id="panel" hidden>
    <h2>预览结果 <span class="n"><span id="pvSummary"></span></span></h2>
    <h2 style="margin-top:6px">改动 <span class="n"><span id="pvChanged"></span> 处 · 步数 <span data-role="steps" id="pvSteps"></span></span></h2>
    <div data-role="changes" id="pvChanges"></div>
    <h2 style="margin-top:10px">拦截 <span class="n"><span id="pvProblems"></span> 条</span></h2>
    <div data-role="problems" id="pvProblemsList"></div>
    <h2 style="margin-top:10px">提示 <span class="n"><span id="pvNotes"></span> 条</span></h2>
    <div data-role="notes" id="pvNotesList"></div>
    <h2 style="margin-top:10px">副作用</h2>
    <div data-role="effects" id="pvEffects"></div>
  </section>

  <section>
    <h2>版本流水 <span class="n">append-only</span></h2>
    <div data-role="journal" id="journal"></div>
    <h2 style="margin-top:10px">外发记录（sink）</h2>
    <div data-role="sink" id="sink"></div>
  </section>
</main>

<div class="bar">
  <div class="info"><span id="batchName"></span> <span class="jm" id="batchOps"></span> <span class="jm" id="batchMode"></span></div>
  <button id="bPack">打包</button>
  <button id="bPreview" disabled data-role="preview">预览</button>
  <button id="bExecute" disabled data-role="execute">执行</button>
  <button id="bRevert" disabled data-role="revert">回退</button>
  <button id="bDiscard" disabled data-role="discard">放弃</button>
</div>
<div class="toast" id="toast" hidden></div>

<script>
/* ============================== core.mjs（内联，去 export） ============================== */
__CORE__
/* ============================== lab-app.js（内联） ============================== */
__APP__
</script>
</body>
</html>
`;

const out = html.replace('__CORE__', core).replace('__APP__', app);
const dest = join(dir, 'lab.html');
writeFileSync(dest, out);
console.log('已生成 ' + dest + '（' + (out.length / 1024).toFixed(1) + ' KB）');
