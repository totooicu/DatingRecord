// 建表语句（schema v1）。
//
// 单独放一个文件：它是一段 130 多行的纯字符串，混在 db.ts 里会把真正的
// 初始化逻辑挤到看不见的地方。改表结构时只需要动这里。

export const SCHEMA_SQL = `
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
  created_at TEXT, updated_at TEXT,
  is_private INTEGER NOT NULL DEFAULT 0
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
  created_at TEXT, updated_at TEXT,
  is_private INTEGER NOT NULL DEFAULT 0
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
  icon_json TEXT,
  is_root INTEGER NOT NULL DEFAULT 0,
  time_range_auto INTEGER NOT NULL DEFAULT 1,
  time_range_start TEXT, time_range_end TEXT,
  device_id TEXT, rev INTEGER NOT NULL DEFAULT 1, hlc TEXT, deleted_at TEXT,
  created_at TEXT, updated_at TEXT,
  is_private INTEGER NOT NULL DEFAULT 0
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

-- 属性模板（schema v3 新增，见 F-P04）：一组 def key 的有序集合
CREATE TABLE IF NOT EXISTS attribute_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  keys_json TEXT NOT NULL DEFAULT '[]',
  device_id TEXT, rev INTEGER NOT NULL DEFAULT 1, hlc TEXT, deleted_at TEXT,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  taken_at TEXT,
  created_at TEXT,
  is_private INTEGER NOT NULL DEFAULT 0
);
-- 内容寻址（schema v2 新增，见 db/migrate.ts）：
--   stored_id   正文引用里用的名字（hash 名），如 A.jpg / A_1.jpg
--   hash_shared 1 = 与别的行同 hash 但内容不同（用户确认过碰撞），参与查重时要排除
-- 这里不给老库加列——ALTER 放在 migrate 里做，建表语句只管新库。

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
