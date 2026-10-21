# 约会记录软件 · 架构设计 v1

> 范围：只做架构，不含实现。目标是让「人物 / 事件集 / 事件」三块能各自演化，又能互相引用而不产生数据一致性泥潭。

---

## 0. 一句话定义

一个 **本地优先（local-first）** 的个人关系档案工具：以 **人物** 为节点、**事件** 为流水、**事件集** 为组织维度，把零散的相处片段组织成可检索、可回溯、可统计的结构化记录。

---

## 1. 目标与非目标

**目标**
1. 人物属性完全自定义：不同人物可以有完全不同的字段集，字段可随时增删。
2. 事件能表达「谁 + 何时 + 何地 + 发生了什么 + 感受/花费/后续影响」。
3. 事件集可无限嵌套（集合套集合），事件可同时属于多个集合。
4. 时间表达宽容：精确到分钟、模糊到「去年夏天」、区间、进行中，都要能存能排。
5. 数据可完整导出为纯 JSON（+ 附件目录），可版本管理、可迁移、不被实现锁定。
6. 检索强：全文 + 结构化筛选（按人物、标签、时间、评分、花费等）。

**非目标（v1 不做）**
- 多人实时协作、在线分享；
- 复杂权限体系（只有「本地加密 + 应用锁」）；
- AI 自动摘要/洞察（v2 再做，架构上留扩展点）。

---

## 2. 领域模型总览

| 概念 | 本质 | 类比 | 生命周期 |
|---|---|---|---|
| **人物 Person** | 实体节点，携带自定义属性集 | 通讯录 + 自定义字段 | 长期，属性可随时间变化 |
| **事件 Event** | 发生过的一次事情，关联若干人物 | 日记条目 / 流水账 | 一次写入，少量回溯编辑 |
| **事件集 Collection** | 事件的容器，可嵌套 | 文件夹 / 相册 / 故事线 | 长期，结构频繁调整 |
| **关系 Relation**（可选第四层） | 人物之间的边 | 社交图谱 | 长期，有起止时间 |

**引用关系（这是整个架构的骨架）**

```
Person ──participates──> Event        （多对多：一次约会多个人，一个人多次约会）
Collection ──contains──> Event        （多对多：一个事件可归入多个集合）
Collection ──contains──> Collection   （嵌套：集合套集合）
Person ──relates──> Person            （可选：恋人/朋友/同事/前任）
Event ──relates──> Event              （可选：前因后果、同一天的连续事件）
```

关键决策：**所有关联都用独立的关联表/关联数组表达，不在实体里内嵌对方的完整数据。** 这样任一实体可独立演化，也不会出现「改了 A 忘了改 B」的不一致。

---

## 3. 人物：动态属性系统

这是「属性可增减、每人不同」的核心。用 **三层结构** 解决：

### 3.1 三层结构

```
第 1 层  属性定义 AttributeDef     —— 字典层：这个字段是什么类型、怎么校验、怎么显示
第 2 层  属性模板 Template（可选）  —— 组合层：一组 def 的集合，按人物类型套用
第 3 层  属性值 AttributeValue      —— 实例层：某个具体人物身上的值
```

### 3.2 AttributeDef（属性定义）

| 字段 | 说明 |
|---|---|
| `key` | 稳定标识（如 `birthday`），**一经创建不可改**，改中文名只改 `label` |
| `label` | 显示名（可随时改） |
| `type` | 类型（见下表） |
| `group` | 分组（基本信息 / 外在 / 喜好 / 关系 / 自定义），用于 UI 分区 |
| `icon` / `color` | 展示用 |
| `required` / `unique` | 校验 |
| `options` | 枚举类型的候选项（可随时增删选项，旧值不会失效） |
| `validation` | `min` / `max` / `regex` / `maxLength` |
| `sensitive` | 是否敏感（加密存储 + 二次认证才显示 + 导出可脱敏） |
| `searchable` | 是否进入全文索引 |
| `filterable` | 是否可作为筛选/排序维度（决定是否建索引） |
| `timeVarying` | 是否会随时间变化 → 决定是否需要记录历史快照 |
| `archived` | 软删除标记（**永不物理删除定义**，避免历史值变成孤儿） |

**属性类型表**

| type | 说明 | 控件 | 典型例子 |
|---|---|---|---|
| `text` / `longtext` | 单行 / 多行文本 | 输入框 | 职业、口头禅 |
| `number` | 数字 + 单位 | 数字框 | 身高(cm)、体重(kg) |
| `money` | 金额 + 币种 | 金额框 | 月收入、单次花费 |
| `date` / `datetime` | 日期 / 日期时间（支持精度） | 日期选择器 | 生日、认识日 |
| `enum` | 单选枚举 | 下拉 | 星座、关系状态 |
| `enumMulti` | 多选枚举 | 多选 | 性格标签 |
| `boolean` | 布尔 | 开关 | 是否已互加微信 |
| `rating` | 评分（可配 max） | 星级 | 好感度、颜值 |
| `tag` | 自由标签（自动补全） | 标签输入 | 爱好 |
| `phone` / `email` / `url` | 联系方式 | 专用控件 | 手机号、微博 |
| `social` | `{platform, handle}` | 组合控件 | 微信/小红书 |
| `address` / `geo` | 地址 / 坐标 | 地图控件 | 常驻地 |
| `color` | 颜色 | 取色器 | 主题色 |
| `media` | 图片/附件引用 | 上传 | 照片 |
| `duration` | 时长 | 时长框 | 通勤时间 |
| `relation` | 指向另一个人物 | 人物选择器 | 室友、介绍人 |
| `json` | 任意结构化数据 | 高级编辑 | 兜底 |
| `computed` | **派生，不落库** | 只读 | 年龄、见面次数、平均评分 |

### 3.3 AttributeValue（实例值）

存在人物的 `attrs` JSON 中。**只存值，不重复存类型**（类型由 def 决定），但保留少量自描述元信息，保证脱离字典也能解析：

```json
"attrs": {
  "birthday":  { "v": "1998-06-12", "precision": "day", "note": "她自己说的" },
  "height":    { "v": 168, "unit": "cm" },
  "affinity":  { "v": 4, "max": 5, "updatedAt": "2025-03-09T10:00:00+08:00" },
  "phone":     { "v": "enc:...", "sensitive": true },
  "hobbies":   { "v": ["攀岩", "爵士乐"] }
}
```

规则：
- 未出现在 `attrs` 中的 def → 视为「空」，不写 null，保持 JSON 干净。
- `attrs` 中出现未知 key → 按 `json` 兜底渲染，**绝不丢弃**（防止导入/降级丢数据）。
- 值的 `updatedAt` 用于展示「这个信息是哪天记下的」。

### 3.4 属性历史（timeVarying）

对 `timeVarying: true` 的字段，每次修改写入历史表，支持「回到 2024 年秋天，她当时的状态是什么」：

```json
"attrHistory": [
  { "key": "affinity", "from": 3, "to": 4,
    "at": "2025-03-09T10:00:00+08:00", "byEvent": "e_01H...", "reason": "看完电影后升温" }
]
```

`byEvent` 把属性变化挂到具体事件上 —— 这是本软件最有价值的能力之一：**属性不是孤立的数字，而是被事件推动的曲线**。UI 上可以画出「好感度随时间变化」折线图。

### 3.5 自定义属性是「增删」，不是「改类型」

- 允许：新增 def、改 label、加枚举选项、归档 def。
- 不允许：改 `key`、改 `type`（会导致已有值无法解释）。
- 真要改类型 → 提供「字段迁移向导」：创建新 key → 批量转换旧值 → 归档旧 key。

---

## 4. 事件

### 4.1 结构

```json
{
  "id": "e_01HX8Z",
  "title": "第一次一起看电影",
  "kind": "date",
  "time": {
    "kind": "interval",
    "start": "2025-03-08T19:20:00+08:00",
    "end":   "2025-03-08T22:10:00+08:00",
    "precision": "minute",
    "tz": "Asia/Shanghai",
    "raw": "上周六晚上",
    "allDay": false
  },
  "place": { "name": "万象城影城", "address": "...", "geo": { "lat": 0, "lng": 0 } },
  "participants": [
    { "personId": "p_01HXA", "role": "primary",
      "note": "她迟到了 10 分钟，说地铁限流",
      "perPerson": { "mood": 5, "spend": 0, "talkative": "high" } },
    { "personId": "p_01HXB", "role": "companion" }
  ],
  "content": { "format": "markdown", "text": "..." },
  "media": ["att_01", "att_02"],
  "tags": ["电影", "第一次"],
  "metrics": {
    "rating": 5, "cost": 128.50, "currency": "CNY",
    "mood": "happy", "intimacyDelta": 1
  },
  "collections": ["c_01", "c_09"],
  "primaryCollectionId": "c_01",
  "relatedEvents": [ { "type": "followedBy", "targetId": "e_01HX9" } ],
  "createdAt": "...", "updatedAt": "...",
  "source": "manual"
}
```

### 4.2 时间模型（重点）

时间的难点是「用户往往记不清」。为此单独设计 `TimeSpec` 值对象：

| kind | 含义 | 存储 |
|---|---|---|
| `instant` | 时刻 | `start` |
| `interval` | 区间 | `start` + `end` |
| `fuzzy` | 模糊（「去年夏天」「大概是 3 月初」） | `start`/`end` 存**估算值** + `precision` + `raw` 原文 |
| `ongoing` | 进行中（无结束） | `start` + `end: null` |
| `recurring` | 周期（每周三健身） | `rrule` + 起始时间 |
| `unknown` | 完全不知道 | 全 null，仅靠 `sortHint` 排序 |

配套策略：
- 每个事件额外冗余两个 **数值时间字段** `start_ts` / `end_ts`（UTC 毫秒），专供索引、排序、范围查询；`time` JSON 保留完整语义供展示。
- `precision` 决定 UI 上的显示粒度（`minute` / `hour` / `day` / `month` / `year`），模糊时间显示时加「约」字。
- **排序键恒为 `start_ts`**，模糊事件用估算值参与排序，保证任何事件都能在时间线上落位。

### 4.3 参与者

- `role`：`primary`（主角）/ `companion`（陪同）/ `thirdParty`（第三方，如她朋友）/ `self`（自己，可选是否显式记录）。
- `perPerson`：单个参与者在此事件中的专属数据（她那天的心情、她付了多少），**这是 JSON 自由字段**，不强制统一。
- 参与者是独立关联表 → 可以高效查「和某个人的所有事件」。

### 4.4 度量与影响

`metrics` 里放可统计的量化字段（评分、花费、亲密度增减）。这些字段会被聚合到人物和事件集上：
- 人物页：见面次数、总花费、平均评分、好感度曲线；
- 事件集页：跨度、事件数、总花费、平均评分。

### 4.5 事件之间的关系

轻量有向边，用于串联因果：`followedBy`（后续）、`causedBy`（起因）、`sameDay`（同日）、`conflictsWith`（矛盾）。v1 只做 `followedBy` 即可。

---

## 5. 事件集

### 5.1 两种集合

| 类型 | 说明 | 成员来源 |
|---|---|---|
| **静态集合** | 手工往里加事件/子集合 | `collection_members` 表，带 `order` |
| **智能集合（Smart）** | 按规则自动收录 | `rule` 条件表达式，查询时动态求值 |

智能集合规则示例：
```json
"rule": {
  "all": [
    { "field": "participants", "op": "includes", "value": "p_01HXA" },
    { "field": "metrics.rating", "op": ">=", "value": 4 }
  ],
  "any": [ { "field": "tags", "op": "has", "value": "旅行" } ]
}
```
智能集合的价值：不用手工维护「所有和她的旅行」这类集合，且永远不遗漏新事件。

### 5.2 嵌套模型

```json
{
  "id": "c_01",
  "name": "和小满的春天",
  "kind": "arc",
  "parentId": "c_root",
  "order": 10,
  "members": [
    { "refType": "event",      "refId": "e_01HX8Z", "order": 1 },
    { "refType": "collection", "refId": "c_09",     "order": 2 }
  ],
  "rule": null,
  "timeRange": { "auto": true },
  "status": "ongoing",
  "attrs": {}
}
```

**推荐方案：MVP 用单父树，数据结构预留多父 DAG。**

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 严格树（单 `parentId`） | UI 清晰、无环、易理解 | 一个子集合只能属于一个父集合 | **MVP 采用** |
| DAG（多父） | 可交叉归类（既在「关系线」又在「2025 年」） | 需防环、面包屑不唯一、UI 复杂 | **v1.5 开放** |
| 树 + 智能集合 | 用智能集合实现交叉归类，避开 DAG 复杂度 | 不能手工微调成员 | **作为 DAG 的替代，优先做** |

实现上，`parentId` 与「闭包表」同时维护：

```sql
collection_closure(ancestor_id, descendant_id, depth)
```
闭包表让「查出某集合下所有层级的事件」变成一次 JOIN，避免递归查询。后续开放多父时，只需把 `parentId` 换成 `collection_parents` 表，闭包表逻辑复用。

**注意：事件集自身的 `timeRange` 默认由成员事件推导（最早 start ~ 最晚 end），允许手动覆盖。** 不要存冗余，否则成员变动后会过期。

### 5.3 归属的单一真相源

- 事件 JSON 里写 `collections: [...]`（便于人读和交换）；
- 存储层以 `collection_members` 关联表为 **唯一真相源**；
- 导入时展开事件的 `collections` 生成关联记录；导出时反向还原。
- 这样避免「事件里说属于 A，A 里却没这个事件」的双写不一致。

---

## 6. 可移植交换格式（.drp 包）

```
my-dating-library.drp/
├── library.json        # 单一 JSON，含全部结构化数据
├── attachments/        # 媒体文件（按 sha256 命名）
└── manifest.json       # 版本、导出时间、附件清单、校验和
```

`library.json` 顶层：

```json
{
  "schemaVersion": 1,
  "meta": { "id": "lib_...", "name": "我的记录", "createdAt": "...", "app": "DatingRecord/1.0" },
  "attributeDefs": [ /* 属性字典 */ ],
  "templates":     [ /* 人物模板 */ ],
  "persons":       [ /* ... */ ],
  "relations":     [ /* 人物关系（可选） */ ],
  "events":        [ /* ... */ ],
  "collections":   [ /* ... */ ],
  "attachments":   [ { "id": "att_01", "sha256": "...", "mime": "image/jpeg", "takenAt": "..." } ]
}
```

设计原则：
- **纯文本、可 diff、可 git 管理**；
- `schemaVersion` + 迁移脚本链，保证老文件永远能打开；
- 附件用内容哈希命名，天然去重，且换机器不丢引用。

---

## 7. 存储方案

> 跨端与同步的完整设计见 **`dating-record-storage-sync.md`**。核心结论：存储选 **SQLite（全端统一）**；同步采用 **oplog + 混合逻辑时钟 + 记录级合并**；**现在只做埋点（ULID / hlc / 墓碑删除 / fractional index），不写同步代码**，将来加同步无需迁移历史数据。

### 7.1 方案对比

| 方案 | 优点 | 缺点 | 适用 |
|---|---|---|---|
| A. 单文件 JSON | 极简、可直接编辑、git 友好 | 数据量大时读写慢、无事务、无并发 | 小数据量 / 交换格式 |
| B. 文件树（YAML+Markdown） | 像 Obsidian，正文可直接用编辑器写，diff 极友好 | 检索需自建索引，关系维护靠约定 | 文本爱好者 |
| C. SQLite + JSON 列 | 事务、索引强、FTS5 全文搜索、JSON1 可索引动态字段 | 不可直接肉眼编辑，需导出 | **主存储推荐** |

### 7.2 推荐：C 为主 + A 为交换格式

**核心表结构**

```sql
-- 人物
persons(id TEXT PK, display_name, aliases_json, kind, status, avatar_att,
        tags_json, attrs_json, search_text, created_at, updated_at)
person_attr_history(id PK, person_id, key, value_json, changed_at, by_event_id, reason)

-- 关系（可选）
relations(id PK, from_person, to_person, type, strength, start_ts, end_ts, attrs_json)

-- 事件
events(id PK, title, kind, start_ts, end_ts, time_json, place_json,
       content, tags_json, metrics_json, created_at, updated_at)
event_participants(event_id, person_id, role, note, per_person_json,
                   PRIMARY KEY(event_id, person_id))

-- 事件集
collections(id PK, name, kind, parent_id, order_index, rule_json,
            time_range_json, status, attrs_json)
collection_closure(ancestor_id, descendant_id, depth,
                   PRIMARY KEY(ancestor_id, descendant_id))
collection_members(collection_id, member_type, member_id, order_index, note,
                   PRIMARY KEY(collection_id, member_type, member_id))

-- 附件 / 审计 / 搜索
attachments(id PK, sha256, mime, path, meta_json, taken_at)
journal(seq INTEGER PK AUTOINCREMENT, ts, op, entity, entity_id, payload_json)
fts_events    USING fts5(title, content, tags, tokenize='unicode61')
fts_persons   USING fts5(display_name, aliases, search_text, tokenize='unicode61')
attribute_defs(key PK, label, type, group, config_json, archived, updated_at)
attribute_templates(id PK, name, keys_json, hlc, deleted_at)   -- F-P04 属性模板
```

**索引**
- `events(start_ts)`、`events(end_ts)` → 时间线查询
- `event_participants(person_id)`、`collection_members(member_id)` → 反向查询
- 表达式索引：`CREATE INDEX ... ON events(json_extract(metrics_json,'$.rating'))` → 高频筛选字段
- 中文全文：FTS5 + `unicode61`（配合 simple 分词或 jieba 预处理）

**关键约束**
- 领域层通过 **Repository 接口** 访问数据，不直接依赖 SQLite → 日后换存储（或加云同步）不动业务代码。
- `journal` 表是 append-only 操作日志：支撑 **撤销/重做、增量同步、误删恢复** 三件事，成本很低但收益很大。

---

## 8. 分层架构

```
┌─────────────────────────────────────────────┐
│ Interface    UI（三栏工作台）/ CLI / HTTP API │
├─────────────────────────────────────────────┤
│ Application  用例：CreateEvent / AddAttr /   │
│              MoveCollection / Query / Export │
├─────────────────────────────────────────────┤
│ Domain       实体 Person·Event·Collection、  │
│              值对象 TimeSpec·AttributeValue、│
│              规则与校验（纯函数，零 IO）      │
├─────────────────────────────────────────────┤
│ Infra        Repository(SQLite) / Search /   │
│              FileStore / Crypto / Migration  │
└─────────────────────────────────────────────┘
```

**目录结构**

```
packages/
  domain/        实体、值对象、校验规则、属性类型系统
  schema/        AttributeDef DSL、JSON Schema、版本迁移脚本
  repository/    存储接口 + SQLite 实现 + 内存实现（测试用）
  search/        索引、查询 DSL、智能集合求值器
  io/            .drp 导入导出、Markdown 导入导出
  app-core/      用例编排（命令层，UI 无关）
  ai/            AI 能力（provider/capability/context/privacy/index/task/guard）
                 —— 单向依赖 Domain，不被 Domain 依赖，可整体关闭
  ui-web/        界面（可换 Electron/Tauri/React Native 外壳）
```

铁律：**Domain 层不 import 任何 IO 库**。它可被单测覆盖，也能原样搬到服务端。

---

## 9. 核心用例（第一批要实现的能力）

**人物**
`createPerson` / `updatePerson` / `archivePerson` / `mergePersons`（合并重复人物）
`addAttribute` / `updateAttribute` / `removeAttribute` / `reorderAttributes`
`defineAttributeDef` / `archiveAttributeDef` / `migrateAttributeType`
`getPersonTimeline`（某人相关的全部事件，按时间倒序）
`getPersonStats`（见面次数、总花费、平均评分、好感度曲线）

**事件**
`createEvent`（含模糊时间解析）/ `updateEvent` / `deleteEvent`
`addParticipant` / `removeParticipant` / `setPerPersonMetrics`
`getEventsByRange` / `getEventsByPerson` / `getEventsByTag` / `searchEvents`
`linkEvents`（前因后果）

**事件集**
`createCollection` / `rename` / `move`（改父级，需重算闭包 + 防环）
`addMember` / `removeMember` / `reorderMembers`
`createSmartCollection` / `evaluateRule`
`getDescendantEvents`（含所有嵌套层级）
`getBreadcrumb` / `getTree`

**系统**
`exportLibrary` / `importLibrary` / `undo` / `redo` / `runMigration`

---

## 10. UI 信息架构

```
┌──────────┬──────────────┬──────────────────────────┐
│ 人物库    │ 事件集树      │ 事件流 / 详情             │
│          │              │                          │
│ 搜索/筛选 │ ▾ 全部        │  2025-03-08 第一次看电影  │
│ 人物卡片  │  ├ 小满线     │  参与者、地点、正文、照片  │
│ 分组/标签 │  │  ├ 春天    │  评分 ★★★★★ 花费 ¥128   │
│          │  │  └ 夏天    │                          │
│          │  └ 2025 年度  │                          │
└──────────┴──────────────┴──────────────────────────┘
```

- **人物详情页**：属性分区展示（按 `group`）+ 属性编辑抽屉 + 相关事件时间线 + 统计看板 + 好感度曲线。
- **事件集页**：面包屑（嵌套层级）+ 成员列表 + 时间跨度 + 聚合统计 + 子集卡片。
- **全局**：快速记录入口（一键「今天和谁做了什么」）、时间线总览、关系图谱（可选视图）。

---

## 11. 横切机制

| 机制 | 做法 |
|---|---|
| **ID** | ULID（时间有序、字符串、无需中心协调），前缀 `p_` / `e_` / `c_` / `att_` |
| **时间存储** | 统一 UTC 毫秒数值（索引/排序）+ ISO8601 带时区字符串（展示）双写 |
| **Schema 迁移** | `schemaVersion` + 迁移脚本链 `v1→v2→v3`，导入时自动升级，绝不静默丢字段 |
| **撤销/重做** | 基于 `journal` 的逆操作栈 |
| **删除** | 一律软删除（`deleted_at`），回收站可恢复；附件引用计数为 0 才真正清理 |
| **隐私** | 数据库整体加密（SQLCipher）+ `sensitive` 字段二次加密；应用锁 + 导出脱敏开关 |
| **备份** | 自动快照 + 导出 `.drp`，建议用户放到自己的网盘/git |
| **性能** | 事件上万条仍应秒开：靠索引 + 分页 + 虚拟滚动；统计结果可选缓存 |

---

## 12. 演进路线

| 阶段 | 内容 |
|---|---|
| **MVP** | 三层模型 + 自定义属性 + 树状事件集 + 时间线 + 全文搜索 + JSON 导入导出 |
| **v1** | 智能集合、属性历史曲线、统计看板、模糊时间解析、撤销重做、加密 |
| **v1.5** | 事件集多父（DAG）、人物关系图谱、事件关联边 |
| **v2** | 端到端加密同步（oplog + 对象存储/WebDAV）、模板市场、AI 能力（详见《AI 能力规划》） |

> AI 能力的完整设计（六层 31 项功能、架构组件、隐私分级与红线）见 **`dating-record-ai-capabilities.md`**。核心约束：AI 是可选增强，关掉后软件完整可用；AI 只产出「建议」，落库带 `source: ai` + `confidence` + 引用事件 ID，永不直接改写档案。

---

## 13. 待确认的关键决策

| # | 决策点 | 本文默认推荐 | 备选 |
|---|---|---|---|
| 1 | 运行形态 | 本地优先桌面/Web 应用 | 移动端、纯静态网页 |
| 2 | 主存储 | SQLite + JSON 列 | 文件树（Markdown）、单文件 JSON |
| 3 | 事件集嵌套 | MVP 单父树 + 智能集合 | 直接上多父 DAG |
| 4 | 属性历史 | 支持（`timeVarying` 字段进历史） | 只存当前值，不做快照 |
| 5 | 人物关系 | 作为可选第四层（关系图） | 暂不做，只靠事件体现 |
| 6 | 同步 | v2 再做 | MVP 就要多设备同步 |
