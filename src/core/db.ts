// 数据层：sql.js(SQLite WASM) + IndexedDB 持久化
// 设计要点：
//   1. 所有实体带 hlc / device_id / rev / deleted_at —— 为将来的跨端同步埋点
//   2. 所有写操作必须与 oplog 在同一事务内完成（同步的核心资产）
//   3. 顺序字段一律用 order_key 字符串（fractional index），不用整数

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { newId } from './id';
import { hlcNow } from './time';
import { FIRST_ORDER_KEY } from './order';
import { SCHEMA_VERSION } from './types';

const IDB_NAME = 'dating-record';
const IDB_STORE = 'files';
const IDB_KEY = 'main.sqlite';

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let deviceIdCache = '';
let saveTimer: number | null = null;
let dirty = false;

// ---------------- 设备 ID ----------------

export function getDeviceId(): string {
  if (deviceIdCache) return deviceIdCache;
  try {
    deviceIdCache = localStorage.getItem('dr.deviceId') ?? '';
  } catch {
    deviceIdCache = '';
  }
  if (!deviceIdCache) {
    deviceIdCache = newId('d');
    try {
      localStorage.setItem('dr.deviceId', deviceIdCache);
    } catch {
      /* 隐私模式下忽略 */
    }
  }
  return deviceIdCache;
}

// ---------------- IndexedDB ----------------

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<Uint8Array | null> {
  try {
    const d = await openIdb();
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = d.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as Uint8Array) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbPut(data: Uint8Array): Promise<void> {
  const d = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(data, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------- 建表（schema v1） ----------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS attribute_defs (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]',
  unit TEXT,
  max_value INTEGER,
  required INTEGER NOT NULL DEFAULT 0,
  sensitive INTEGER NOT NULL DEFAULT 0,
  time_varying INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  order_key TEXT NOT NULL,
  device_id TEXT, rev INTEGER NOT NULL DEFAULT 1, hlc TEXT, deleted_at TEXT,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL DEFAULT 'person',
  status TEXT NOT NULL DEFAULT 'active',
  avatar TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  attrs_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  device_id TEXT, rev INTEGER NOT NULL DEFAULT 1, hlc TEXT, deleted_at TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_persons_status ON persons(status);

CREATE TABLE IF NOT EXISTS person_attr_history (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  attr_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  by_event_id TEXT,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_attrhist ON person_attr_history(person_id, attr_key);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  start_ts INTEGER,
  end_ts INTEGER,
  time_json TEXT NOT NULL DEFAULT '{}',
  place_json TEXT NOT NULL DEFAULT '{}',
  content TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  media_json TEXT NOT NULL DEFAULT '[]',
  related_json TEXT NOT NULL DEFAULT '[]',
  primary_collection_id TEXT,
  device_id TEXT, rev INTEGER NOT NULL DEFAULT 1, hlc TEXT, deleted_at TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_ts);
CREATE INDEX IF NOT EXISTS idx_events_deleted ON events(deleted_at);

CREATE TABLE IF NOT EXISTS event_participants (
  event_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'primary',
  note TEXT NOT NULL DEFAULT '',
  per_person_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (event_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_ep_person ON event_participants(person_id);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'arc',
  parent_id TEXT,
  order_key TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover TEXT,
  status TEXT NOT NULL DEFAULT 'ongoing',
  rule_json TEXT,
  is_root INTEGER NOT NULL DEFAULT 0,
  time_range_auto INTEGER NOT NULL DEFAULT 1,
  time_range_start TEXT, time_range_end TEXT,
  device_id TEXT, rev INTEGER NOT NULL DEFAULT 1, hlc TEXT, deleted_at TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_collections_parent ON collections(parent_id);

CREATE TABLE IF NOT EXISTS collection_closure (
  ancestor_id TEXT NOT NULL,
  descendant_id TEXT NOT NULL,
  depth INTEGER NOT NULL,
  PRIMARY KEY (ancestor_id, descendant_id)
);
CREATE INDEX IF NOT EXISTS idx_closure_desc ON collection_closure(descendant_id);

CREATE TABLE IF NOT EXISTS collection_members (
  collection_id TEXT NOT NULL,
  member_type TEXT NOT NULL,
  member_id TEXT NOT NULL,
  order_key TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  device_id TEXT, hlc TEXT, deleted_at TEXT,
  PRIMARY KEY (collection_id, member_type, member_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_member ON collection_members(member_id);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  taken_at TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS oplog (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  hlc TEXT NOT NULL,
  device_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oplog_hlc ON oplog(hlc);
`;

// ---------------- 初始化 ----------------

/**
 * 初始化数据库。
 *
 * `onProgress` 用于把阶段进度透给首屏加载态——WASM 有近 700KB，
 * 弱网下这一步可能要几十秒，没有反馈用户会以为页面挂了。
 */
export async function initDb(onProgress?: (msg: string) => void): Promise<Database> {
  if (db) return db;
  const report = (m: string) => onProgress?.(m);

  // 用 BASE_URL 拼接，保证部署到子路径（如 GitHub Pages 的 /DatingRecord/）时也能取到
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  report('正在加载数据库引擎…');
  SQL = await initSqlJs({
    locateFile: () => `${base}sql-wasm.wasm`,
  });
  // 引擎到手就该能干活了，之后都是本地同步操作，把超时计时清掉

  report('正在读取本地数据…');
  const bytes = await idbGet();
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');

  report('正在准备数据表…');
  migrate(db);

  // 页面隐藏/关闭前尽力落盘，减少丢数据的窗口
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushPersist);
  }
  return db;
}

/** 迁移链：按 schemaVersion 逐级升级 */
function migrate(d: Database): void {
  d.run(SCHEMA_SQL);
  const row = queryOne<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['schema_version']);
  const current = row ? Number(row.value) : 0;

  if (current < 1) {
    seedDefaults(d);
    setMeta('schema_version', String(SCHEMA_VERSION));
  }
  // 未来：if (current < 2) { ...升级...; setMeta('schema_version','2') }
  setMeta('last_opened_at', new Date().toISOString());
}

function seedDefaults(d: Database): void {
  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());
  const defaults: [string, string, string, string, number?, number?, number?, number?][] = [
    // key, label, type, group, max, required, sensitive, timeVarying
    ['birthday', '生日', 'date', '基本信息', 0, 0, 0, 0],
    ['occupation', '职业', 'text', '基本信息', 0, 0, 0, 1],
    ['height', '身高', 'number', '外在', 0, 0, 0, 1],
    ['affinity', '好感度', 'rating', '关系', 5, 0, 1, 1],
    ['phone', '手机号', 'phone', '联系方式', 0, 0, 1, 0],
    ['hobbies', '爱好', 'tag', '喜好', 0, 0, 0, 0],
  ];
  let idx = 0;
  for (const [key, label, type, group, max, req, sens, tv] of defaults) {
    d.run(
      `INSERT OR IGNORE INTO attribute_defs
       (key, label, type, group_name, options_json, unit, max_value, required, sensitive, time_varying,
        archived, order_key, device_id, rev, hlc, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,1,?,?,?)`,
      [
        key,
        label,
        type,
        group,
        '[]',
        type === 'number' ? 'cm' : null,
        max ?? null,
        req ?? 0,
        sens ?? 0,
        tv ?? 0,
        String(idx++),
        getDeviceId(),
        hlc,
        now,
        now,
      ],
    );
  }

  // 根集合
  const rootId = newId('c');
  d.run(
    `INSERT OR IGNORE INTO collections
     (id, name, kind, parent_id, order_key, description, status, is_root, time_range_auto,
      device_id, rev, hlc, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [rootId, '全部', 'root', null, FIRST_ORDER_KEY, '', 'ongoing', 1, 1, getDeviceId(), 1, hlc, now, now],
  );
  d.run(
    'INSERT OR REPLACE INTO collection_closure (ancestor_id, descendant_id, depth) VALUES (?,?,0)',
    [rootId, rootId],
  );
}

export function setMeta(key: string, value: string): void {
  getDb().run('INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)', [key, value]);
  markDirty();
}

export function getMeta(key: string): string | null {
  const row = queryOne<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  return row ? row.value : null;
}

// ---------------- 查询辅助 ----------------

export function getDb(): Database {
  if (!db) throw new Error('数据库尚未初始化，请先调用 initDb()');
  return db;
}

export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const d = getDb();
  const stmt = d.prepare(sql);
  try {
    stmt.bind(params as never[]);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

export function queryOne<T>(sql: string, params: unknown[] = []): T | null {
  const rows = queryAll<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export function run(sql: string, params: unknown[] = []): void {
  getDb().run(sql, params as never[]);
}

/** 写事务：业务变更 + oplog 原子提交 */
export function transact<T>(fn: () => T): T {
  const d = getDb();
  d.run('BEGIN');
  try {
    const result = fn();
    d.run('COMMIT');
    markDirty();
    return result;
  } catch (err) {
    try {
      d.run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** 追加操作日志（供将来的同步 / 撤销 / 审计使用） */
export function appendOplog(
  entity: string,
  entityId: string,
  op: 'insert' | 'update' | 'delete',
  payload?: unknown,
): void {
  run(
    `INSERT INTO oplog (hlc, device_id, entity, entity_id, op, payload, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      hlcNow(getDeviceId()),
      getDeviceId(),
      entity,
      entityId,
      op,
      payload === undefined ? null : JSON.stringify(payload),
      new Date().toISOString(),
    ],
  );
}

// ---------------- 持久化 ----------------

export function markDirty(): void {
  dirty = true;
  if (saveTimer !== null) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void persist();
  }, 500);
}

/** 立即落盘（关闭页面、清空数据等场景用，避免 debounce 未触发导致丢数据） */
export function flushPersist(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  void persist();
}

export async function persist(): Promise<void> {
  if (!db || !dirty) return;
  dirty = false;
  const bytes = db.export();
  await idbPut(new Uint8Array(bytes));
}

/** 彻底清空本地数据（危险操作，UI 需二次确认） */
export async function resetAll(): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
  try {
    const d = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
  await initDb();
}
