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
  icon_json TEXT,
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
  /* 呈现形态：doc = 普通正文，chat = 聊天形式。与 kind（语义类型）互不干扰 */
  view_mode TEXT NOT NULL DEFAULT 'doc',
  device_id TEXT, rev INTEGER NOT NULL DEFAULT 1, hlc TEXT, deleted_at TEXT,
  created_at TEXT, updated_at TEXT,
  is_private INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_ts);
CREATE INDEX IF NOT EXISTS idx_events_deleted ON events(deleted_at);

/* 聊天形式的消息（v9）。
   一条消息不是一个能独立被引用的实体——它不被别的事件关联、也不单独进时间线，
   所以归在事件下面，但独立成表：这样插入/删除/改单条都能独立同步与撤销，
   不用每次动一条就整段重写事件的 JSON。 */
CREATE TABLE IF NOT EXISTS event_messages (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  /* 分数排序键：两端并发插入不会撞车，见 core/order.ts */
  order_key TEXT NOT NULL,
  /* msg = 消息气泡，divider = 旁白（无头像、占一行） */
  type TEXT NOT NULL DEFAULT 'msg',
  /* 可空：旁白没有头像；消息未指派人物时也没有 */
  person_id TEXT,
  /* 头像在左还是在右；默认按参与者 role='self' 推，可手动翻转 */
  side TEXT NOT NULL DEFAULT 'left',
  body TEXT NOT NULL DEFAULT '',
  /* 可空：只有旁白或确实需要时才填，不强制——随手记录不该被逼着填时间 */
  ts INTEGER,
  /* 回复（引用）了哪条消息；可空。旁白不能被回复，所以只有 type='msg' 会有值 */
  reply_to TEXT,
  device_id TEXT, rev INTEGER NOT NULL DEFAULT 1, hlc TEXT, deleted_at TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_event ON event_messages(event_id, order_key);

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
  /* 模板事件（v13）：新建本集合下的事件时按它预填字段；可空 = 不套模板 */
  template_event_id TEXT,
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
  is_private INTEGER NOT NULL DEFAULT 0,
  source_url TEXT
);
-- 映射文件（schema v11 新增，见 db/migrate.ts）：
--   source_url 非空 = 库里只存链接，二进制不落 IndexedDB（见 F-E05 映射文件）
-- 内容寻址（schema v2 新增，见 db/migrate.ts）：
--   stored_id   正文引用里用的名字（hash 名），如 A.jpg / A_1.jpg
--   hash_shared 1 = 与别的行同 hash 但内容不同（用户确认过碰撞），参与查重时要排除
-- 这里不给老库加列——ALTER 放在 migrate 里做，建表语句只管新库。

-- AI 模型（schema v6 新增，见 F-AI01）：
--   别名 alias 是调用时选的那个名字（「便宜的好模型」比 gpt-4o-mini 好记），
--   同一个模型可以起多个别名指向不同参数的调用。
--   api_key 不在这张表里：凭据只进 meta（前缀 ai.key.），不进备份、不同步。
CREATE TABLE IF NOT EXISTS ai_models (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'siliconflow',
  base_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  temperature REAL NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 1024,
  capabilities TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  device_id TEXT, rev INTEGER NOT NULL DEFAULT 1, hlc TEXT, deleted_at TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_alias ON ai_models(alias);

-- 回忆录（schema v12 新增）：
--   事件集里的一次回顾。pages_json 只存「指向哪个事件 + 选图 / 摘句 / 导语」，
--   标题、时间、地点、正文都从 events 实时取，避免复制正文后与事件脱节。
--   scope_json 是冻结的事件 id 快照（见 core/types/memoir.ts）。
CREATE TABLE IF NOT EXISTS memoirs (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  cover_file_id TEXT,
  playlist_id TEXT,
  scope_json TEXT NOT NULL DEFAULT '{}',
  pages_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual',
  ai_model TEXT,
  device_id TEXT, rev INTEGER NOT NULL DEFAULT 1, hlc TEXT, deleted_at TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_memoirs_collection ON memoirs(collection_id);

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
