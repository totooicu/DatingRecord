/**
 * DR 沙盒内核 · 面向「AI 可能改动任何内容」的状态沙盒
 *
 * 纯 ESM、零依赖、不碰 DOM；Node 与浏览器都能直接 import。
 * 概念只有四个：
 *   state      已提交的世界状态（一棵 JSON 树，AI 想改哪儿都行，但必须先过沙盒）
 *   op         声明式指令（set/delete/insert/reorder/rename/create/effect/bulk）
 *   changeset  一批 op 的草稿：begin → dispatch* → dryRun → commit / discard
 *   journal    版本流水：commit 与 revert 都只追加，不删除
 *
 * 设计前提：把 AI 当成「会递过来任何 JSON 的实习生」。它可能写错类型、改到不该改的
 * 路径、塞一段脚本进来、删掉被引用的实体、一次改五千个字段、或者同一批指令两次算出
 * 两个结果。沙盒的职责不是让 AI 别犯错，而是让犯错的指令进不了状态。
 *
 * 详细接入方式见同目录《接入手册.md》。
 */

/* ---------------------------------------------------------------- 基础工具 */

/** 路径里出现这些段就拒绝：既是原型污染防线，也保护沙盒自己的账本与密钥 */
export const PROTECTED_SEGMENTS = ['sandbox', '__proto__', 'constructor', 'prototype', 'secrets', 'keys', 'ledger', 'env'];

/** 允许的声明式指令类型 */
export const OP_KINDS = ['set', 'delete', 'insert', 'reorder', 'rename', 'create', 'effect', 'bulk'];

/** 明确拉黑的指令类型：AI 递过来就直接拒，不给降级执行的余地 */
export const FORBIDDEN_KINDS = ['script', 'function', 'js', 'javascript', 'eval', 'import', 'require', 'raw-sql', 'sql', 'shell', 'bash', 'command', 'exec', 'html', 'dom', 'fetch'];

export const DEFAULT_POLICY = {
  mode: 'atomic',            // atomic：一条不过整集不进；lenient：跳过坏条继续
  unknownPath: 'strict',     // strict：schema 没写的路径拒绝；open：允许但记 note
  maxOps: 200,               // 单批指令上限（bulk 展开后计数）
  maxBytes: 64 * 1024,       // 单条指令写入值的字节上限
  maxChanges: 400,           // 单批影响字段数上限
  maxDepth: 12,              // 路径段数上限
  allowCreateEntity: true,   // 是否允许 create
};

export function clone(v) { return JSON.parse(JSON.stringify(v)); }
export function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function bytes(v) { try { const s = JSON.stringify(v); return s === undefined ? 0 : new TextEncoder().encode(s).length; } catch { return Infinity; } }
export function parsePath(p) { return Array.isArray(p) ? p.map(String) : String(p ?? '').split('.').filter((s) => s.length); }
export function joinPath(segs) { return segs.join('.'); }
export function truncate(s, n) { const t = String(s); return t.length > (n || 40) ? t.slice(0, n || 40) + '…' : t; }

/** 键排序后的稳定序列化：JSON 对象的键序不是数据，rename 重放会改变键序，比较时必须忽略 */
export function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (isPlain(v)) { const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = canon(v[k]); }); return o; }
  return v === undefined ? null : v;
}
export function sameState(a, b) { return JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }

export function getAt(root, segs) {
  let cur = root;
  for (const s of segs) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = cur[s];
  }
  return cur;
}

/**
 * 取路径的父容器。create=true 时补建缺失的中间层（下一段是数字就建数组）。
 * 中途撞上非对象（字符串、数字、null）就返回 null，让上层报 bad-path。
 */
function containerAt(root, segs, create) {
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    if (cur === null || typeof cur !== 'object') return null;
    if (!(s in cur)) {
      if (!create) return null;
      cur[s] = /^\d+$/.test(segs[i + 1]) ? [] : {};
    }
    cur = cur[s];
    if (cur === null || typeof cur !== 'object') return null;
  }
  return cur;
}

function setAt(root, segs, value) {
  if (!segs.length) return false;
  const box = containerAt(root, segs, true);
  if (!box) return false;
  box[segs[segs.length - 1]] = value;
  return true;
}

function delAt(root, segs) {
  if (!segs.length) return { ok: false, reason: '路径为空' };
  const box = containerAt(root, segs, false);
  if (!box) return { ok: false, reason: '父节点不存在' };
  const key = segs[segs.length - 1];
  if (!(key in box)) return { ok: false, reason: '目标不存在' };
  const old = box[key];
  if (Array.isArray(box)) box.splice(Number(key), 1); else delete box[key];
  return { ok: true, old };
}

/** 把任意值摊成叶子路径，用于逐叶校验与逐叶 diff */
export function leaves(value, prefix = [], out = [], depth = 0) {
  if (depth > 12) { out.push({ segs: prefix.slice(), value: truncate(JSON.stringify(value), 80) }); return out; }
  if (Array.isArray(value)) {
    if (!value.length) out.push({ segs: prefix.slice(), value: [] });
    value.forEach((v, i) => leaves(v, prefix.concat(String(i)), out, depth + 1));
    return out;
  }
  if (isPlain(value)) {
    const ks = Object.keys(value);
    if (!ks.length) out.push({ segs: prefix.slice(), value: {} });
    ks.forEach((k) => leaves(value[k], prefix.concat(k), out, depth + 1));
    return out;
  }
  out.push({ segs: prefix.slice(), value });
  return out;
}

/** 遍历所有节点（含容器），供引用扫描用 */
function walkAll(node, segs, visit) {
  visit(segs, node);
  if (Array.isArray(node)) { node.forEach((v, i) => walkAll(v, segs.concat(String(i)), visit)); return; }
  if (isPlain(node)) { for (const k of Object.keys(node)) walkAll(node[k], segs.concat(k), visit); }
}

/* ---------------------------------------------------------------- schema */

/** `*` 匹配一段，`**` 匹配剩余任意多段（含零段） */
export function matchPattern(patSegs, pathSegs) {
  for (let i = 0; i < patSegs.length; i++) {
    if (patSegs[i] === '**') return true;
    if (i >= pathSegs.length) return false;
    if (patSegs[i] === '*') continue;
    if (patSegs[i] !== pathSegs[i]) return false;
  }
  return patSegs.length === pathSegs.length || patSegs[patSegs.length - 1] === '**';
}

/** 取最长（最具体）的匹配规则 */
export function ruleFor(schema, segs) {
  let best = null;
  let bestLen = -1;
  for (const r of schema) {
    const ps = parsePath(r.path);
    if (matchPattern(ps, segs) && ps.length > bestLen) { best = r; bestLen = ps.length; }
  }
  return best;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** 单值校验：类型、长度、枚举、数组项、引用池长度 */
export function checkScalar(rule, v, pathStr) {
  const problems = [];
  const want = rule.type;
  if (v === undefined) {
    if (rule.required) problems.push({ code: 'bad-value', msg: pathStr + '：必填，不能缺省' });
    return problems;
  }
  if (v === null) {
    if (rule.required || (want && want !== 'any')) problems.push({ code: 'bad-value', msg: pathStr + '：不能为 null（规则要求 ' + want + '）' });
    return problems;
  }
  if (want === 'string' && typeof v !== 'string') problems.push({ code: 'bad-value', msg: pathStr + '：应为字符串，实际是 ' + typeOf(v) + '（' + truncate(JSON.stringify(v), 24) + '）' });
  if (want === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) problems.push({ code: 'bad-value', msg: pathStr + '：应为有限数字，实际是 ' + truncate(JSON.stringify(v), 24) });
  if (want === 'boolean' && typeof v !== 'boolean') problems.push({ code: 'bad-value', msg: pathStr + '：应为布尔，实际是 ' + typeOf(v) });
  if (want === 'date' && !(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([T\s].*)?$/.test(v))) problems.push({ code: 'bad-value', msg: pathStr + '：应为 YYYY-MM-DD 日期，实际是 ' + truncate(JSON.stringify(v), 24) });
  if (want === 'hex' && !(typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v))) problems.push({ code: 'bad-value', msg: pathStr + '：应为 #rrggbb，实际是 ' + truncate(JSON.stringify(v), 24) });
  if (want === 'array' && !Array.isArray(v)) problems.push({ code: 'bad-value', msg: pathStr + '：应为数组，实际是 ' + typeOf(v) });
  if (want === 'object' && !isPlain(v)) problems.push({ code: 'bad-value', msg: pathStr + '：应为对象，实际是 ' + typeOf(v) });
  if (want === 'any') return problems;
  if (typeof v === 'string') {
    if (rule.max !== undefined && v.length > rule.max) problems.push({ code: 'bad-value', msg: pathStr + '：长度 ' + v.length + ' 超过上限 ' + rule.max });
    if (rule.min !== undefined && v.length < rule.min) problems.push({ code: 'bad-value', msg: pathStr + '：长度 ' + v.length + ' 低于下限 ' + rule.min });
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (rule.max !== undefined && want !== 'string' && v > rule.max) problems.push({ code: 'bad-value', msg: pathStr + '：' + v + ' 超过上限 ' + rule.max });
    if (rule.min !== undefined && v < rule.min) problems.push({ code: 'bad-value', msg: pathStr + '：' + v + ' 低于下限 ' + rule.min });
  }
  if (Array.isArray(v)) {
    if (rule.maxItems !== undefined && v.length > rule.maxItems) problems.push({ code: 'bad-value', msg: pathStr + '：数组 ' + v.length + ' 项，超过上限 ' + rule.maxItems });
    if (rule.minItems !== undefined && v.length < rule.minItems) problems.push({ code: 'bad-value', msg: pathStr + '：数组 ' + v.length + ' 项，低于下限 ' + rule.minItems });
    if (rule.items && rule.items !== 'any') v.forEach((x, i) => problems.push(...checkScalar({ type: rule.items, enum: rule.itemEnum, max: rule.itemMax }, x, pathStr + '[' + i + ']')));
  }
  if (rule.enum && !rule.enum.includes(v)) problems.push({ code: 'bad-value', msg: pathStr + '：' + truncate(JSON.stringify(v), 24) + ' 不在允许值 ' + rule.enum.join('/') + ' 内' });
  return problems;
}

/* ---------------------------------------------------------------- 令牌（非确定值） */

/** FNV-1a 派生的确定性随机源：同种子同路径永远同一个数 */
export function hashRnd(seedText, path) {
  let h = 2166136261;
  const s = seedText + '@' + (path || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

/**
 * 把值里的 {{...}} 令牌落地。
 *  - {{now}} {{uuid}} {{random}}：由本批 seed/clock 决定 → 预览与执行结果逐字相同，可重放
 *  - {{env:KEY}}：读外部只读快照并登记依赖，执行前外部值若已变 → 整批拒绝（env-drift）
 * ctx 缺省给一个哑上下文，便于单测与离线渲染。
 */
export function resolveTokens(value, ctx, pathStr) {
  const c = ctx || { clockISO: '', env: {}, envDeps: new Set(), uuid: () => 'x0', random: () => 0 };
  const notes = [];
  const walk = (v, segs) => {
    if (typeof v === 'string') {
      return v.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr) => {
        const key = expr.trim();
        if (key === 'now') { notes.push({ code: 'token', token: 'now', path: joinPath(segs), msg: (pathStr || joinPath(segs)) + '：时间戳冻结在本批开始时刻，预览与执行一致' }); return c.clockISO; }
        if (key === 'uuid') { notes.push({ code: 'token', token: 'uuid', path: joinPath(segs), msg: '随机 id 由本批种子决定，可重放' }); return c.uuid(joinPath(segs)); }
        if (key === 'random') { notes.push({ code: 'token', token: 'random', path: joinPath(segs), msg: '随机数由本批种子决定，可重放' }); return String(c.random(joinPath(segs)).toFixed(6)); }
        if (key.startsWith('env:')) {
          const k = key.slice(4);
          c.envDeps.add(k);
          const found = k in c.env;
          notes.push({ code: found ? 'env-read' : 'env-missing', envKey: k, path: joinPath(segs), msg: found ? '读取外部值 ' + k + '（执行前若变化会拒绝提交）' : '外部值 ' + k + ' 不存在，按空字符串写入' });
          return found ? String(c.env[k]) : '';
        }
        notes.push({ code: 'token-unknown', path: joinPath(segs), msg: '不认识的令牌 {{' + key + '}}，按原文保留' });
        return '{{' + key + '}}';
      });
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, segs.concat(String(i))));
    if (isPlain(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = walk(v[k], segs.concat(k)); return o; }
    return v;
  };
  return { value: walk(value, []), notes };
}

/* ---------------------------------------------------------------- 沙盒 */

export function createSandbox(config) {
  const cfg = config || {};
  const policy = Object.assign({}, DEFAULT_POLICY, cfg.policy || {});
  const schema = cfg.schema || [];
  const effectRegistry = cfg.effects || {};

  let state = clone(cfg.world);
  const versions = [{ seq: 0, label: '初始状态', kind: 'seed', ops: [], undo: [], effects: [], snapshot: clone(state), at: cfg.at || 'T0', changed: 0, skipped: 0 }];
  let batch = null;   // {name, ops, mode, seed, clockISO, envSnapshot, dry}

  function head() { return versions[versions.length - 1]; }
  function versionAt(seq) { return versions.find((x) => x.seq === seq); }

  /* ---------------------------------------------------- 批次与上下文 */

  function begin(name, opts) {
    const o = opts || {};
    const seed = o.seed !== undefined ? String(o.seed) : String(Date.now());
    const seedText = '#' + versions.length + '#seed=' + seed;                          // 令牌只由种子+版本号决定，批次名称给人看不影响数据
    batch = {
      name: name || ('批次 ' + versions.length),
      ops: [],
      mode: o.mode || policy.mode,
      seed: seedText,
      clockISO: o.clockISO || new Date(0).toISOString(),
      envSnapshot: clone(o.env !== undefined ? o.env : (cfg.env || {})),
      protoNotes: [],
      dry: null,
    };
    return { name: batch.name, mode: batch.mode, seed: seedText, clockISO: batch.clockISO };
  }

  /** 一趟 pass 共用一个上下文：令牌按路径取值，所以与遍历顺序无关，可重放 */
  function makeCtx() {
    const b = batch;
    return {
      clockISO: b.clockISO,
      env: b.envSnapshot,
      envDeps: new Set(),
      uuid(p) { return 'x' + Math.floor(hashRnd(b.seed, p) * 1e9).toString(36); },
      random(p) { return hashRnd(b.seed, p); },
    };
  }

  /* ---------------------------------------------------- 声明式 op 规范化 */

  /**
   * 进入校验前先把 op 里的「代码形状」洗掉：
   * AI 很爱塞 __proto__、constructor、Symbol 键，JSON.stringify 会静默丢掉 undefined 和函数，
   * 所以这里手写序列化保证「带函数的对象」也能安全克隆，并且原型键不会污染克隆体。
   */
  function safeValue(v, depth, seen) {
    const d = depth || 0;
    if (d > 24) return '[深度超限，已截断]';
    const s = seen || new Set();
    if (v === null) return null;
    const t = typeof v;
    if (t === 'undefined' || t === 'function' || t === 'symbol') return undefined;
    if (t === 'number') return Number.isFinite(v) ? v : null;
    if (t === 'string' || t === 'boolean') return v;
    if (t === 'bigint') return String(v);
    if (s.has(v)) return '[循环引用，已截断]';
    if (Array.isArray(v)) return v.map((x) => { const r = safeValue(x, d + 1, s); return r === undefined ? null : r; });
    const out = Object.create(null);
    for (const k of Object.keys(v)) {
      if (k === '__proto__') continue;                       // 反原型污染：静默丢弃
      const r = safeValue(v[k], d + 1, s);
      if (r !== undefined) out[k] = r;
    }
    s.delete(v);
    return out;
  }

  /** 克隆 op，同时把可疑键名收集成 problems */
  const notesProto = [];
  /** 指令对象上出现 __proto__/constructor/prototype 键：静默丢弃（JSON.parse 会造出这种自有键），只在预览里留痕 */
  function protoNotes() {
    const uniq = Array.from(new Set(notesProto));
    notesProto.length = 0;
    return uniq.map((k) => ({ code: 'proto-keys', msg: '指令里的原型相关键 "' + k + '" 已被丢弃，不会被执行' }));
  }
  function normalizeOp(op, problems, opId) {
    if (op === null || typeof op !== 'object' || Array.isArray(op)) { problems.push({ opId: opId || null, code: 'not-declarative', msg: '指令必须是对象，实际是 ' + typeOf(op) + (Array.isArray(op) ? '（数组）' : ''), fix: '让 AI 输出 {kind, path, value} 形式' }); return null; }
    const dropped = [];
    const out = Object.create(null);
    for (const k of Object.keys(op)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') { notesProto.push(k); continue; }
      const v = safeValue(op[k], 0, null);
      if (v === undefined) dropped.push(k + '（' + typeof op[k] + '，不可序列化）'); else out[k] = v;
    }
    if (dropped.length) { problems.push({ opId: opId || null, code: 'not-declarative', msg: '指令含不可执行内容，本条作废：' + dropped.join('、'), fix: '只保留数据字段；可执行逻辑请改用已登记的 effect' }); return null; }
    return out;
  }

  /** bulk 递归展开；带环检测与深度上限，避免 AI 造出自引用或超深嵌套 */
  function expand(raw, rootId, idx, out, meta, guard) {
    const id = rootId ? rootId + '#' + idx : (raw && raw.id) || 'op' + (idx + 1);
    const g = guard || { depth: 0, seen: new Set() };
    if (raw === null || typeof raw !== 'object' || g.depth > policy.maxDepth) {
      meta.bad.push({ id, msg: 'bulk 结构非法或嵌套超过 ' + policy.maxDepth + ' 层' });
      return out;
    }
    if (g.seen.has(raw)) { meta.bad.push({ id, msg: 'bulk 里存在循环引用' }); return out; }
    g.seen.add(raw);
    if (raw.kind === 'bulk') {
      const kids = Array.isArray(raw.ops) ? raw.ops : null;
      if (!kids) { meta.bad.push({ id, msg: 'bulk 的 ops 必须是数组，实际是 ' + typeOf(raw.ops) }); return out; }
      kids.forEach((child, i) => expand(child, id, i, out, meta, { depth: g.depth + 1, seen: g.seen }));
    } else {
      out.push(Object.assign({}, raw, { id, group: rootId || id }));
    }
    g.seen.delete(raw);
    return out;
  }

  function protectedHit(segs) {
    return segs.find((s) => PROTECTED_SEGMENTS.includes(s) || /__/.test(s));
  }

  /** create 用的规则：只认声明了 entity 字段的规则，且取最长匹配 */
  function entityRuleFor(segsList) {
    let best = null;
    let bestLen = -1;
    for (const r of schema) {
      if (!r.entity) continue;
      const ps = parsePath(r.path);
      if (matchPattern(ps, segsList) && ps.length > bestLen) { best = r; bestLen = ps.length; }
    }
    return best;
  }

  /* ---------------------------------------------------- 引用扫描（防悬挂） */

  /** 找出所有仍指向 id 的引用位置；excludePath 为被删节点自身路径，其内部引用不计 */
  function referrers(stateNow, collPath, id, excludePath) {
    const out = [];
    const ex = joinPath(excludePath);
    for (const r of schema) {
      if (!r.ref || joinPath(parsePath(r.ref)) !== collPath) continue;
      const ps = parsePath(r.path);
      walkAll(stateNow, [], (segs, val) => {
        const p = joinPath(segs);
        if (p === ex || p.startsWith(ex + '.')) return;
        if (!matchPattern(ps, segs)) return;
        if (val === id) out.push({ path: p, segs: segs.slice(), via: 'scalar', field: r.path });
        else if (Array.isArray(val)) val.forEach((x, i) => { if (x === id) out.push({ path: p + '.' + i, segs: segs.concat(String(i)), via: 'element', field: r.path }); });
      });
    }
    return out;
  }

  /* ---------------------------------------------------- 值校验 */

  /** 修值建议：把 schema 里的约束拼成人话 */
  function fixFor(rule) {
    const bits = ['按 schema 修值：' + (rule.type || 'any')];
    if (rule.enum) bits.push('允许 ' + rule.enum.join('/'));
    if (rule.max !== undefined) bits.push('最大 ' + rule.max);
    if (rule.min !== undefined) bits.push('最小 ' + rule.min);
    if (rule.maxItems !== undefined) bits.push('最多 ' + rule.maxItems + ' 项');
    if (rule.ref) bits.push('必须是 ' + rule.ref + ' 里存在的 id');
    return bits.join('，');
  }

  function inPool(cur, rule, item) {
    const pool = getAt(cur, parsePath(rule.ref));
    if (Array.isArray(pool)) return pool.some((x) => (isPlain(x) ? x.id : x) === item);
    if (isPlain(pool)) return pool[item] !== undefined;
    return false;
  }

  /**
   * 递归校验一个值。
   *  - 有规则的节点：查类型/长度/枚举/maxItems/ref（ref 对数组逐元素查）
   *  - 没规则但还能往下走的节点：继续走子节点（整对象写入时不该在容器层报未知路径）
   *  - 叶子没规则：strict 报 unknown-path，open 放行
   */
  function checkValue(cur, v, segs, op, problems, inherited, entityTable, entityPath, depth) {
    const d = (depth || 0) + 1;
    if (d > policy.maxDepth) return true;                     // 深到这不合理：早由 maxDepth/oversize 拦下，这里只防栈溢出
    let rule = ruleFor(schema, segs) || inherited;
    if (!rule && entityTable && entityPath && segs.length === entityPath.length + 1 && Object.prototype.hasOwnProperty.call(entityTable, segs[entityPath.length])) {
      rule = entityTable[segs[entityPath.length]];               // create 出来的实体：entity 表就是这些字段的规则
    }
    const pathStr = joinPath(segs);
    if (rule) {
      const ps = checkScalar(rule, v, pathStr);
      if (ps.length) { problems.push({ opId: op.id, code: ps[0].code, msg: ps[0].msg, fix: fixFor(rule) }); return false; }
      if (rule.ref) {
        const items = Array.isArray(v) ? v : [v];
        for (const it of items) {
          if (!inPool(cur, rule, it)) { problems.push({ opId: op.id, code: 'bad-ref', msg: pathStr + ' 引用了不存在的 ' + rule.ref + '：' + truncate(JSON.stringify(it), 24), fix: '先建实体再引用，或改成已有 id' }); return false; }
        }
      }
    }
    const childInherit = rule && rule.items && rule.items !== 'any' ? { type: rule.items, enum: rule.itemEnum, max: rule.itemMax } : null;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) if (!checkValue(cur, v[i], segs.concat(String(i)), op, problems, childInherit, entityTable, entityPath, d)) return false;
      return true;
    }
    if (isPlain(v)) {
      for (const k of Object.keys(v)) if (!checkValue(cur, v[k], segs.concat(k), op, problems, null, entityTable, entityPath, d)) return false;
      return true;
    }
    if (!rule && policy.unknownPath === 'strict') { problems.push({ opId: op.id, code: 'unknown-path', msg: '没有规则约束 ' + pathStr, fix: '补 schema 规则，或让 AI 改已存在的字段' }); return false; }
    return true;
  }

  function pushChanges(changes, segs, before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const bl = before === undefined ? [] : leaves(before);
    const al = leaves(after);
    const bmap = new Map(bl.map((x) => [joinPath(x.segs), x.value]));
    const amap = new Map(al.map((x) => [joinPath(x.segs), x.value]));
    const full = (k) => joinPath(segs.concat(k === '' ? [] : k.split('.')));
    for (const [k, v] of amap) {
      if (!bmap.has(k)) changes.push({ path: full(k), kind: 'add', before: undefined, after: v, opId: null });
      else if (JSON.stringify(bmap.get(k)) !== JSON.stringify(v)) changes.push({ path: full(k), kind: 'mod', before: bmap.get(k), after: v, opId: null });
    }
    for (const [k, v] of bmap) if (!amap.has(k)) changes.push({ path: full(k), kind: 'del', before: v, after: undefined, opId: null });
  }

  /* ---------------------------------------------------- 单条 op：校验 + 就地应用 */

  function applyOp(cur, op, ctx, problems, notes, changes, undo, effects) {
    let entityRules = null;
    const fail = (code, msg, fix) => { problems.push({ opId: op.id, code, msg, fix: fix || '' }); return false; };
    const label = op.id || '?';

    if (FORBIDDEN_KINDS.includes(op.kind)) return fail('not-declarative', '拒绝非声明式指令（kind:' + op.kind + '）：沙盒只接受数据变更，不接受可执行代码', '改成 set/delete/insert 等数据操作，或走已登记的 effect');
    if (!OP_KINDS.includes(op.kind)) return fail('bad-kind', label + '：未知指令类型 ' + truncate(JSON.stringify(op.kind), 24));

    const segs = op.kind === 'effect' ? [] : parsePath(op.path !== undefined ? op.path : op.at);
    const hit = protectedHit(segs);
    if (hit) return fail('protected', label + '：路径 ' + joinPath(segs) + ' 命中保护区（段 "' + hit + '"），账本与密钥不允许被指令改动');

    if (segs.length > policy.maxDepth) return fail('bad-path', label + '：路径 ' + segs.length + ' 段，超过上限 ' + policy.maxDepth);

    if (op.kind === 'effect') {
      const reg = effectRegistry[op.name];
      if (!reg) return fail('unknown-effect', label + '：沙盒没登记过副作用 ' + truncate(JSON.stringify(op.name), 24) + '，拒绝', '先在 effects 里登记，并声明 compensate / irreversible');
      const args = resolveTokens(op.args || {}, ctx, 'effect.' + op.name).value;
      effects.push({ opId: op.id, name: op.name, args, irreversible: !!reg.irreversible, compensate: reg.compensate || null });
      undo.push({ kind: 'effect', name: op.name, args });
      notes.push({ code: 'effect', msg: '副作用 ' + op.name + ' 预览阶段只登记不外发' + (reg.irreversible ? '（不可逆：执行后回退需要 force）' : (reg.compensate ? '（可补偿：' + reg.compensate + '）' : '')) });
      return true;
    }

    if (op.kind !== 'create' && !segs.length) return fail('bad-path', label + '：路径为空');

    if (op.kind === 'create') {
      if (!policy.allowCreateEntity) return fail('policy', label + '：当前策略禁止新建实体');
      const at = parsePath(op.at);
      if (!at.length) return fail('bad-path', label + '：create 缺少 at');
      const hitAt = protectedHit(at);
      if (hitAt) return fail('protected', label + '：不能在受保护路径 ' + joinPath(at) + ' 下新建');
      const resolved = resolveTokens(op.value || {}, ctx, joinPath(at));
      resolved.notes.forEach((n) => notes.push(n));
      const val0 = safeValue(resolved.value || {}, 0, null) || {};
      const collRule = entityRuleFor(at);
      if (!collRule) return fail('unknown-path', label + '：集合 ' + joinPath(at) + ' 没有带 entity 的 schema 规则，沙盒不知道能建什么样的实体', '给该集合补一条 { path, entity: { 字段: 规则 } }');
      {
        const extra = Object.keys(val0).filter((k) => !(k in collRule.entity) && k !== 'id');
        if (extra.length && policy.unknownPath === 'strict') return fail('unknown-path', label + '：新建实体含 entity 表里没声明的字段 ' + extra.join('、'), '在 entity 表补字段，或让 AI 别造新字段');
        if (extra.length) notes.push({ code: 'open-create', msg: '字段 ' + extra.join('、') + ' 未在 entity 表声明，按 open 策略放行' });
        entityRules = collRule.entity;
      }
      const box = containerAt(cur, at, true);
      if (!box) return fail('bad-path', label + '：无法在 ' + joinPath(at) + ' 下新建：中段不是容器');
      const key = at[at.length - 1];
      const val = val0;
      const id = op.id2 !== undefined ? String(op.id2) : (val.id !== undefined ? String(val.id) : 'n' + Math.floor(ctx.random(joinPath(at)) * 1e6).toString(36));
      if (/__/.test(id) || PROTECTED_SEGMENTS.includes(id) || /^\s|\s$/.test(id) || id.length > 64) return fail('bad-value', label + '：新实体 id 非法：' + truncate(JSON.stringify(id), 40), 'id 用普通字符，不要含双下划线、保护区名或首尾空格');
      const coll = box[key];
      const isArr = Array.isArray(coll);
      // 只有「以 id 为键的表」或 entity 里声明了 id 的集合才写入 id；纯数组记录不强塞 id
      const wantsId = !isArr || (entityRules && entityRules.id) || val.id !== undefined;
      const ent = wantsId ? Object.assign({}, val, { id }) : Object.assign({}, val);
      let entPath = at.concat(id);
      if (isArr) {
        if (wantsId && coll.some((x) => isPlain(x) && String(x.id) === id)) return fail('dup-id', label + '：实体 id ' + id + ' 已存在');
        const idx = coll.length;
        const next = coll.slice();
        next.push(ent);
        const old = coll;
        box[key] = next;
        entPath = at.concat(String(idx));
        pushChanges(changes, at, old, next);
        undo.push({ kind: 'set', path: joinPath(at), value: old });
      } else {
        if (isPlain(coll) && coll[id] !== undefined) return fail('dup-id', label + '：实体 id ' + id + ' 已存在');
        if (coll !== undefined && !isPlain(coll)) return fail('bad-path', label + '：' + joinPath(at) + ' 既不是数组也不是对象表，无法 create');
        const old = coll;
        box[key] = Object.assign({}, coll, { [id]: ent });
        changes.push({ path: joinPath(entPath), kind: 'add', before: undefined, after: ent, opId: op.id });
        undo.push({ kind: 'set', path: joinPath(at), value: old });
      }
      if (!checkValue(cur, ent, entPath, op, problems, null, entityRules, entPath)) return false;
      if (entityRules) {
        for (const k of Object.keys(ent)) {
          if (ruleFor(schema, entPath.concat(k))) continue;
          const er = entityRules[k];
          if (!er) continue;
          const ps = checkScalar(er, ent[k], joinPath(entPath.concat(k)));
          if (ps.length) return fail(ps[0].code, label + '：' + ps[0].msg, fixFor(er));
        }
        for (const k of Object.keys(entityRules)) if (entityRules[k].required && ent[k] === undefined) return fail('bad-value', label + '：新建实体缺必填字段 ' + k);
      }
      notes.push({ code: 'created', msg: '新建实体 ' + joinPath(entPath) });
      return true;
    }

    const parentSegs = segs.slice(0, -1);
    if (parentSegs.length && op.kind !== 'create') {
      const pv = getAt(cur, parentSegs);
      if (pv !== undefined && (pv === null || typeof pv !== 'object')) return fail('bad-path', label + '：无法写入 ' + joinPath(segs) + '，父节点 ' + joinPath(parentSegs) + ' 是' + typeOf(pv) + '，不是容器');
    }

    // 前值断言：AI 基于旧版本发的指令，在这里撞车，而不是静默覆盖
    if (op.expect !== undefined) {
      const actual = getAt(cur, segs);
      if (JSON.stringify(actual) !== JSON.stringify(op.expect)) {
        return fail('conflict', label + '：前值断言不匹配，期望 ' + truncate(JSON.stringify(op.expect), 40) + '，实际 ' + (actual === undefined ? '（无此节点）' : truncate(JSON.stringify(actual), 40)) + '；内容已被别的批次改过', '重新预览，或让 AI 基于最新版本重发指令');
      }
    }

    const valueRes = op.value !== undefined ? resolveTokens(op.value, ctx, joinPath(segs)) : { value: undefined, notes: [] };
    valueRes.notes.forEach((n) => notes.push(n));
    const value = valueRes.value;

    if ((op.kind === 'set' || op.kind === 'insert') && value === undefined) return fail('bad-value', label + '：' + op.kind + ' 缺少 value（value 为 undefined 或函数会被静默丢掉，这里直接拒绝）');

    if (op.kind === 'set' && getAt(cur, segs) === undefined && parentSegs.length && getAt(cur, parentSegs) === undefined) {
      return fail('no-target', label + '：' + joinPath(segs) + ' 的父节点 ' + joinPath(parentSegs) + ' 不存在，set 不能凭空造实体', '新建实体请改用 create');
    }

    if (policy.unknownPath === 'strict' && op.kind === 'set') {
      const exists = getAt(cur, segs) !== undefined;
      if (!exists && !ruleFor(schema, segs) && !ruleFor(schema, segs.slice(0, -1))) return fail('unknown-path', label + '：路径 ' + joinPath(segs) + ' 既不在 schema 里、父节点也不存在', '补 schema 规则，或让 AI 改已存在的字段');
    }

    // 先看体量再看规则：一条 20 万字的正文，本质是「太大」，不是「格式不对」
    const payload = op.value !== undefined ? op.value : (op.from !== undefined || op.to !== undefined ? { from: op.from, to: op.to } : op.to);
    if (bytes(payload) > policy.maxBytes) return fail('oversize', label + '：单条写入 ' + bytes(payload) + ' 字节，超过上限 ' + policy.maxBytes, '拆成多条，或让 AI 只给增量');

    if (value !== undefined && op.kind !== 'insert' && !checkValue(cur, value, segs, op, problems, null)) return false;

    switch (op.kind) {
      case 'set': {
        const before = getAt(cur, segs);
        undo.push({ kind: before === undefined ? 'delete' : 'set', path: joinPath(segs), value: before });
        if (!setAt(cur, segs, value)) { undo.pop(); return fail('bad-path', label + '：无法写入 ' + joinPath(segs) + '：路径中段不是对象'); }
        pushChanges(changes, segs, before, value);
        return true;
      }
      case 'delete': {
        const before = getAt(cur, segs);
        if (before === undefined) return fail('no-target', label + '：要删的 ' + joinPath(segs) + ' 不存在');
        const collPath = joinPath(segs.slice(0, -1));
        const id = isPlain(before) && before.id !== undefined ? String(before.id) : segs[segs.length - 1];
        const refs = collPath ? referrers(cur, collPath, id, segs) : [];
        if (refs.length && !op.cascade) return fail('dangling', label + '：删除 ' + joinPath(segs) + ' 会留下 ' + refs.length + ' 处悬挂引用：' + refs.slice(0, 3).map((r) => r.path).join('、'), '加 cascade:true 让沙盒级联清理，或先改引用');
        const r = delAt(cur, segs);
        if (!r.ok) return fail('no-target', label + '：删除失败——' + r.reason);
        changes.push({ path: joinPath(segs), kind: 'del', before, after: undefined, opId: op.id });
        undo.push({ kind: 'set', path: joinPath(segs), value: before });
        if (op.cascade && refs.length) {
          const byParent = new Map();
          for (const ref of refs) {
            if (ref.via === 'element') { const pp = joinPath(ref.segs.slice(0, -1)); if (!byParent.has(pp)) byParent.set(pp, []); byParent.get(pp).push(ref); }
            else { const old = getAt(cur, ref.segs); delAt(cur, ref.segs); changes.push({ path: ref.path, kind: 'del', before: old, after: undefined, opId: op.id, via: 'cascade' }); undo.push({ kind: 'set', path: ref.path, value: old }); }
          }
          for (const [pp, list] of byParent) {
            const arr = getAt(cur, parsePath(pp));
            if (!Array.isArray(arr)) continue;
            const old = arr.slice();
            const next = arr.filter((x) => x !== id);
            setAt(cur, parsePath(pp), next);
            changes.push({ path: pp, kind: 'mod', before: old, after: next, opId: op.id, via: 'cascade' });
            undo.push({ kind: 'set', path: pp, value: old });
          }
          notes.push({ code: 'cascade', msg: '级联清理 ' + refs.length + ' 处引用' });
        }
        return true;
      }
      case 'insert': {
        const arr = getAt(cur, segs);
        if (!Array.isArray(arr)) return fail('bad-path', label + '：' + joinPath(segs) + ' 不是数组，无法插入');
        if (op.index !== undefined && (typeof op.index !== 'number' || !Number.isInteger(op.index))) return fail('bad-index', label + '：insert 的 index 必须是整数，实际是 ' + truncate(JSON.stringify(op.index), 24));
        const at = op.index === undefined ? arr.length : Math.max(0, Math.min(arr.length, op.index));
        const next = arr.slice();
        next.splice(at, 0, value === undefined ? null : value);
        const old = arr;
        setAt(cur, segs, next);
        const arrRule = ruleFor(schema, segs);
        const itemInherit = arrRule && arrRule.items && arrRule.items !== 'any' ? { type: arrRule.items, enum: arrRule.itemEnum, max: arrRule.itemMax } : null;
        if (!checkValue(cur, value, segs.concat(String(at)), op, problems, itemInherit)) { setAt(cur, segs, old); return false; }
        pushChanges(changes, segs, old, next);
        undo.push({ kind: 'set', path: joinPath(segs), value: old });
        return true;
      }
      case 'reorder': {
        const arr = getAt(cur, segs);
        if (!Array.isArray(arr)) return fail('bad-path', label + '：' + joinPath(segs) + ' 不是数组，无法重排');
        const from = Number(op.from); const to = Number(op.to);
        if (!Number.isInteger(from) || from < 0 || from >= arr.length) return fail('bad-index', label + '：reorder 起点 ' + truncate(JSON.stringify(op.from), 12) + ' 越界（长度 ' + arr.length + '）');
        if (!Number.isInteger(to) || to < 0 || to >= arr.length) return fail('bad-index', label + '：reorder 终点 ' + truncate(JSON.stringify(op.to), 12) + ' 越界（长度 ' + arr.length + '）');
        const next = arr.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        const old = arr;
        setAt(cur, segs, next);
        pushChanges(changes, segs, old, next);
        undo.push({ kind: 'set', path: joinPath(segs), value: old });
        return true;
      }
      case 'rename': {
        const box = containerAt(cur, segs, false);
        const key = segs[segs.length - 1];
        if (!box || !(key in box)) return fail('no-target', label + '：要改名的 ' + joinPath(segs) + ' 不存在');
        const to = op.to;
        if (typeof to !== 'string' || !to.trim()) return fail('bad-value', label + '：rename 缺少合法新名字（to 必须是非空字符串）');
        if (/__/.test(to) || PROTECTED_SEGMENTS.includes(to) || to.includes('.')) return fail('protected', label + '：不允许把名字改成 ' + truncate(JSON.stringify(to), 24));
        const oldVal = box[key];
        const next = Object.create(null);
        for (const k of Object.keys(box)) { if (k === key) next[to] = box[k]; else next[k] = box[k]; }
        if (Object.keys(next).length !== Object.keys(box).length) return fail('dup-id', label + '：目标名 ' + to + ' 已存在');
        for (const k of Object.keys(box)) delete box[k];
        for (const k of Object.keys(next)) box[k] = next[k];
        const newPath = segs.slice(0, -1).concat(to);
        changes.push({ path: joinPath(segs), kind: 'del', before: oldVal, after: undefined, opId: op.id });
        changes.push({ path: joinPath(newPath), kind: 'add', before: undefined, after: oldVal, opId: op.id });
        undo.push({ kind: 'rename-back', path: joinPath(segs.slice(0, -1)), from: to, to: key });
        return true;
      }
      default:
        return fail('bad-kind', label + '：未实现的指令类型 ' + op.kind);
    }
  }

  /* ---------------------------------------------------- 跑一趟 */

  function runPass() {
    const problems = [];
    const notes = [];
    notesProto.length = 0;
    const empty = { ok: false, aborted: true, problems: [{ opId: null, code: 'no-batch', msg: '没有进行中的批次', fix: '先 begin' }], notes, changes: [], undo: [], effects: [], failed: [], flat: [], applied: 0, skipped: 0, ops: 0, envDeps: [], at: '' };
    if (!batch) return empty;
    const ctx = makeCtx();
    let cur = clone(state);
    const changes = [];
    const undo = [];
    const effects = [];
    const failed = [];
    const flat = [];
    const meta = { bad: [] };
    batch.ops.forEach((raw, i) => {
      const op = normalizeOp(raw, problems, (raw && raw.id) || 'op' + (i + 1));
      if (!op) return;
      try {
        expand(op, null, i, flat, meta);
      } catch (e) {
        meta.bad.push({ id: op.id || 'op' + (i + 1), msg: '展开时出错：' + truncate(e && e.message, 60) });
      }
    });
    meta.bad.forEach((b) => problems.push({ opId: b.id, code: 'not-declarative', msg: 'bulk 展开失败：' + b.msg, fix: 'bulk 只能是 ops 数组的树，不能自引用、不能超深' }));
    batch.protoNotes.forEach((n) => notes.push(n));
    protoNotes().forEach((n) => notes.push(n));

    let applied = 0;
    let skipped = 0;
    let aborted = false;
    if (flat.length > policy.maxOps) {
      problems.push({ opId: null, code: 'too-many-ops', msg: '本批 ' + flat.length + ' 条（含 bulk 展开），超过上限 ' + policy.maxOps, fix: '让 AI 分批' });
      aborted = true;
    } else {
      for (const op of flat) {
        const before = clone(cur);
        const marks = [notes.length, changes.length, undo.length, effects.length];
        const badBefore = problems.length;
        let ok = false;
        try {
          ok = applyOp(cur, op, ctx, problems, notes, changes, undo, effects);
        } catch (e) {
          problems.push({ opId: op.id, code: 'bad-shape', msg: '这条指令让沙盒内部出错，已回滚并作废：' + truncate(e && e.message, 80), fix: '换一种写法；若反复出现，说明该形态内核没覆盖到' });
          ok = false;
        }
        if (!ok) {
          cur = before;                                                     // 整条回滚，绝不留半截状态
          notes.length = marks[0]; changes.length = marks[1]; undo.length = marks[2]; effects.length = marks[3];
          skipped++;
          if (batch.mode === 'atomic') {
            aborted = true;                                                 // 原子模式：坏条留在 problems 里，不另记 failed，避免同一问题被数两遍
            break;
          }
          for (let i = badBefore; i < problems.length; i++) failed.push({ opId: op.id, code: problems[i].code, msg: problems[i].msg, fix: problems[i].fix });
          problems.length = badBefore;                                       // 宽松模式：坏条转成 failed，好条继续算
          continue;
        }
        applied++;
      }
    }
    if (changes.length > policy.maxChanges) { problems.push({ opId: null, code: 'too-many-changes', msg: '影响 ' + changes.length + ' 个字段，超过上限 ' + policy.maxChanges, fix: '缩小范围或分批' }); aborted = true; }
    const clean = batch.mode === 'atomic' ? !aborted : skipped === 0;
    const res = {
      ok: !problems.length && clean,
      aborted,
      problems, notes, changes, undo, effects, failed,
      applied, skipped, ops: flat.length,
      envDeps: Array.from(ctx.envDeps),
      at: batch.clockISO,
      mode: batch.mode,
      result: aborted ? clone(state) : clone(cur),                            // 原子模式下不过就整个不给你看
      flat: clone(flat),
      before: clone(state),
    };
    batch.dry = res;
    return res;
  }

  function dryRun() { return runPass(); }

  /** 幂等自检：同一批连跑两次逐字比较。AI 混进真随机/真时间/依赖顺序的指令会在这里露馅 */
  function checkDeterminism() {
    const a = runPass();
    const b = runPass();
    const norm = (r) => JSON.stringify({ changes: r.changes, result: canon(r.result), effects: (r.effects || []).map((e) => ({ name: e.name, args: e.args })), applied: r.applied, skipped: r.skipped, problems: (r.problems || []).map((p) => p.code + p.msg), envDeps: r.envDeps });
    const stable = norm(a) === norm(b);
    return { stable, first: a, second: stable ? undefined : b };
  }

  /* ---------------------------------------------------- 提交 */

  /**
   * 提交门槛（顺序不可换）：
   *   1. 两次预览逐字相同（unstable）
   *   2. 无问题；lenient 模式允许 acceptPartial 提交「好条」
   *   3. 外部快照没漂移（env-drift）
   *   4. 再跑一遍必须复现预览结果（unstable）
   * 通过后：追加版本 → 落状态 → 副作用这时候才外发。
   */
  function commit(o) {
    const opts = o || {};
    if (!batch) return { ok: false, code: 'no-batch', msg: '没有进行中的批次' };
    const det = checkDeterminism();
    if (!det.stable) return { ok: false, code: 'unstable', msg: '同一批指令两次预览结果不同，沙盒不放行', detail: { first: det.first.problems, second: det.second.problems } };
    const res = det.first;
    const partial = res.mode === 'lenient' && !res.aborted && res.applied > 0 && res.skipped > 0;
    if (!res.ok && !(partial && opts.acceptPartial === true)) {
      return { ok: false, code: 'blocked', msg: res.aborted ? '本批被中止（整批不过或超上限），未提交' : '有 ' + res.problems.length + ' 个问题未解决，未提交', detail: res, partial };
    }

    const live = cfg.env || {};
    const drift = res.envDeps.filter((k) => JSON.stringify(live[k]) !== JSON.stringify(batch.envSnapshot[k]));
    if (drift.length) return { ok: false, code: 'env-drift', msg: '外部值在执行前变了：' + drift.join('、') + '；请基于新值重新预览', detail: drift };

    // 第三次独立复算：复现不了预览结果就不落状态
    let live2 = clone(state);
    const ctx = makeCtx();
    const problems = [];
    const notes = [];
    const changes = [];
    const undo = [];
    const effects = [];
    const failed = [];
    notesProto.length = 0;
    for (const op of res.flat) {
      const before = clone(live2);
      const marks = [notes.length, changes.length, undo.length, effects.length];
      const badBefore = problems.length;
      let ok = false;
      try { ok = applyOp(live2, op, ctx, problems, notes, changes, undo, effects); } catch (e) { problems.push({ opId: op.id, code: 'bad-shape', msg: '提交复算时内部出错', fix: '' }); ok = false; }
      if (!ok) {
        live2 = before;
        notes.length = marks[0]; changes.length = marks[1]; undo.length = marks[2]; effects.length = marks[3];
        if (batch.mode === 'atomic') return { ok: false, code: 'blocked', msg: '提交复算时撞到坏条，原子批次不提交', detail: { problems } };
        for (let i = badBefore; i < problems.length; i++) failed.push({ opId: op.id, code: problems[i].code, msg: problems[i].msg, fix: problems[i].fix });
        problems.length = badBefore;                       // 坏条转成 failed，好条照常提交
      }
    }
    if (!sameState(live2, res.result)) return { ok: false, code: 'unstable', msg: '提交时复算的结果与预览不一致，沙盒不放行', detail: { failed, problems } };
    if (problems.length) return { ok: false, code: 'blocked', msg: '提交时复查失败，未提交', detail: { problems }, failed };

    if (!effects.length && sameState(live2, state)) { const n = batch.name; batch = null; return { ok: true, noop: true, version: head().seq, label: n, changed: 0, effects: 0, partial: false, failed: [] }; }
    const label = batch.name + (failed.length ? '（部分执行 ' + (res.applied) + '/' + res.ops + '）' : '');
    const v = { seq: head().seq + 1, label, kind: 'commit', ops: clone(res.flat), undo, effects, snapshot: clone(live2), at: batch.clockISO, changed: changes.length, skipped: failed.length };
    versions.push(v);
    state = live2;
    for (const e of effects) sink.push({ type: 'flush', name: e.name, args: e.args, version: v.seq });   // 副作用只在提交后外发
    const name = batch.name;
    batch = null;
    return { ok: true, version: v.seq, label: name, changed: changes.length, effects: effects.length, partial: failed.length > 0, failed };
  }

  /* ---------------------------------------------------- 回退 */

  function applyUndo(cur, u) {
    if (u.kind === 'state') return clone(u.value);
    const segs = parsePath(u.path);
    if (u.kind === 'set') { if (!setAt(cur, segs, clone(u.value))) return cur; return cur; }
    if (u.kind === 'delete' || u.kind === 'delete-created') { delAt(cur, segs); return cur; }
    if (u.kind === 'rename-back') {
      const box = containerAt(cur, segs.concat(u.from), false);
      if (box && u.from in box) {
        const next = Object.create(null);
        for (const k of Object.keys(box)) { if (k === u.from) next[u.to] = box[k]; else next[k] = box[k]; }
        for (const k of Object.keys(box)) delete box[k];
        for (const k of Object.keys(next)) box[k] = next[k];
      }
      return cur;
    }
    return cur;
  }

  /**
   * 回退双轨校验：先按 undo 逆序重放，再与上一版 snapshot 比对。
   * 两条路算出不同结果说明内核自己写错了 → 宁可拒绝回退，也不覆盖真实状态。
   */
  function lastAppliedVersion() {
    for (let i = versions.length - 1; i >= 0; i--) {
      const v = versions[i];
      if ((v.kind === 'commit' || v.kind === 'redo') && !v.reverted) return v;
    }
    return null;
  }

  /**
   * 回退。规则：
   *  - 默认退「最近一次还没被回退的执行」，回退链可以一直往前拆，不必先把回退记录本身退掉
   *  - 退一条 revert 记录 = 重做那一版（撤销那次回退）
   *  - 双轨自检：按 undo 重放的结果必须与上一版快照一致，否则 undo-mismatch 拒绝
   *  - 含不可逆副作用的版本默认拒绝回退，force 才放行并转人工
   */
  function revert(opts) {
    const o = opts || {};
    const h = head();
    const last = lastAppliedVersion();
    if (o.seq === undefined && !last) return { ok: false, code: 'no-version', msg: '没有待回退的执行了；要恢复某次回退掉的版本，请显式传入那条回退记录的 seq' };
    const target = o.seq === undefined ? last.seq : Number(o.seq);
    const v = versionAt(target);
    if (!v || v.kind === 'seed') return { ok: false, code: 'no-version', msg: '没有可回退的版本 #' + target };
    let prev;
    if (v.kind === 'revert') {
      if (target !== h.seq) return { ok: false, code: 'not-lifo', msg: '只能重做最新的一条回退记录（最新是 #' + h.seq + '）' };
      prev = versionAt(target - 1);
    } else {
      if (v.reverted) return { ok: false, code: 'already-reverted', msg: '#' + target + ' 已经回退过了，不能重复回退', fix: '要恢复那一版，请回退它对应的那条回退记录 #' + (v.revertSeq || '?') };
      if (!last || target !== last.seq) return { ok: false, code: 'not-lifo', msg: '只能回退最近一次执行（当前是 #' + (last ? last.seq : '无') + '，你要退 #' + target + '）', fix: last ? '先回退 #' + last.seq : '' };
      prev = versionAt(target - 1);
    }
    if (!prev) return { ok: false, code: 'no-version', msg: '找不到 #' + target + ' 的前一版快照' };
    const blocked = v.effects.filter((e) => e.irreversible);
    if (blocked.length && !o.force) return { ok: false, code: 'irreversible', msg: '#' + target + ' 含不可逆副作用 ' + blocked.map((b) => b.name).join('、') + '，回退不了', fix: '需要 force:true 并由人工确认外部状态已处理' };

    let cur = clone(state);
    for (let i = v.undo.length - 1; i >= 0; i--) {
      if (v.undo[i].kind === 'effect') continue;              // 副作用靠补偿，不靠 undo
      cur = applyUndo(cur, v.undo[i]);
    }
    if (!sameState(cur, prev.snapshot)) {
      return { ok: false, code: 'undo-mismatch', msg: '逆操作算出的状态与上一版快照不一致，内核记账有偏差，已拒绝回退', detail: { byUndo: cur, snapshot: prev.snapshot } };
    }
    for (const e of v.effects) {
      if (e.irreversible) sink.push({ type: 'manual', name: e.name, args: e.args, version: v.seq });
      else if (e.compensate) sink.push({ type: 'compensate', name: e.compensate, args: e.args, version: v.seq });
      else sink.push({ type: 'withdraw', name: e.name, args: e.args, version: v.seq });
    }
    const isRedo = v.kind === 'revert';
    const rv = { seq: h.seq + 1, skipped: 0, label: isRedo ? '重做 #' + target + '「' + v.label + '」' : '回退 #' + target + '「' + v.label + '」', kind: isRedo ? 'redo' : 'revert', ops: [], undo: [{ kind: 'state', value: clone(state) }], redoOf: isRedo ? v.redoOf : target, effects: [], snapshot: clone(prev.snapshot), at: o.at || 'T' + versions.length, changed: v.changed };
    versions.push(rv);
    if (isRedo) { const src = versionAt(v.redoOf); if (src) src.reverted = false; } else { v.reverted = true; v.revertSeq = rv.seq; }
    state = clone(prev.snapshot);   // 以快照为准，undo 只用于自检
    return { ok: true, version: rv.seq, backTo: target - 1, redo: isRedo };
  }

  function discard() { const n = batch ? batch.ops.length : 0; batch = null; return n; }
  function pending() { return batch ? clone(batch.ops) : []; }

  /* ---------------------------------------------------- 对外接口 */

  const sink = cfg.sink || [];

  const api = {
    begin,
    /** 追加一条 op 到当前批次草稿（此时还不校验，只在 dryRun/commit 时算） */
    dispatch(op) {
      if (!batch) return { ok: false, code: 'no-batch', msg: '先 begin 一个批次' };
      const problems = [];
      const norm = normalizeOp(op, problems, op && op.id);
      if (!norm) return { ok: false, code: problems[0].code, msg: problems[0].msg, problems };
      batch.ops.push(norm);
      protoNotes().forEach((n) => batch.protoNotes.push(n));
      batch.dry = null;
      return { ok: true, index: batch.ops.length - 1, id: norm.id || 'op' + batch.ops.length };
    },
    dispatchAll(ops) {
      const res = [];
      (ops || []).forEach((o, i) => res.push(api.dispatch(Object.assign({ id: 'op' + (i + 1) }, o))));
      return res;
    },
    dryRun,
    checkDeterminism,
    commit,
    revert,
    discard,
    state() { return clone(state); },
    head,
    lastApplied: () => { const v = lastAppliedVersion(); return v ? { seq: v.seq, label: v.label, kind: v.kind } : null; },
    journal() { return versions.map((v) => ({ seq: v.seq, label: v.label, kind: v.kind, changed: v.changed || 0, skipped: v.skipped || 0, reverted: !!v.reverted, effects: v.effects.length, at: v.at, undo: v.undo.length, ops: v.ops.length })); },
    versionAt,
    snapshotOf(seq) { const v = versionAt(seq); return v ? clone(v.snapshot) : null; },
    pending,
    batchInfo() { return batch ? { name: batch.name, mode: batch.mode, ops: batch.ops.length, clockISO: batch.clockISO, seed: batch.seed, dry: batch.dry ? { ok: batch.dry.ok, changes: batch.dry.changes.length, problems: batch.dry.problems.length } : null } : null; },
    setMode(m) { if (batch) batch.mode = m === 'lenient' ? 'lenient' : 'atomic'; else policy.mode = m === 'lenient' ? 'lenient' : 'atomic'; },
    setEnv(k, v) { cfg.env = Object.assign({}, cfg.env || {}, { [k]: v }); },
    getEnv(k) { return k === undefined ? clone(cfg.env || {}) : (cfg.env || {})[k]; },
    registerEffect(name, def) { if (!name || PROTECTED_SEGMENTS.includes(name)) return { ok: false, code: 'protected', msg: '不允许登记该副作用名' }; effectRegistry[name] = Object.assign({}, safeValue(def, 0, null)); return { ok: true }; },
    effects() { return Object.keys(effectRegistry).map((n) => ({ name: n, irreversible: !!effectRegistry[n].irreversible, compensate: effectRegistry[n].compensate || null })); },
    ruleFor(segs) { return ruleFor(schema, parsePath(segs)); },
    schema: () => clone(schema),
    sink,
    policy,
    versions,
  };
  return api;
}

/* ---------------------------------------------------------------- 结构化 diff（预览用） */

export function diffTrees(a, b) {
  const out = [];
  const al = a === undefined ? [] : leaves(a);
  const bl = b === undefined ? [] : leaves(b);
  const amap = new Map(al.map((x) => [joinPath(x.segs), x.value]));
  const bmap = new Map(bl.map((x) => [joinPath(x.segs), x.value]));
  for (const [k, v] of bmap) {
    if (!amap.has(k)) out.push({ path: k, kind: 'add', after: v });
    else if (JSON.stringify(amap.get(k)) !== JSON.stringify(v)) out.push({ path: k, kind: 'mod', before: amap.get(k), after: v });
  }
  for (const [k, v] of amap) if (!bmap.has(k)) out.push({ path: k, kind: 'del', before: v });
  return out;
}

/** 分类一批 changes：预览只展示增/删/改， untouched 计数用于说明「其余没动」 */
export function classify(changes) {
  const list = [];
  const seen = new Set();
  for (const c of changes) {
    const key = c.path + '|' + c.kind;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ path: c.path, kind: c.kind, before: c.before, after: c.after, via: c.via || null, opId: c.opId || null });
  }
  return list;
}
