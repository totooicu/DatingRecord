# 开发手册

> 规范「怎么开发」「开发什么」「以后开发什么」。
> **每天动手前看这份文档**；技术决策的细节查对应的专题文档。

---

## 0. 文档体系与使用方式

| 文档 | 定位 | 什么时候看 |
|---|---|---|
| `dating-record-architecture.md` | 架构设计：三层模型、数据模型、分层、存储 | 动手写任何模块前 |
| `dating-record-ai-capabilities.md` | AI 能力规划（六层 31 项、隐私红线） | 做 AI 相关功能时 |
| `dating-record-storage-sync.md` | 跨端与同步设计（SQLite、oplog、HLC） | 建表、写同步时 |
| **`DEVELOPMENT.md`（本手册）** | **开发流程规范 + 功能规格 + 路线图** | **每次开工** |

铁律：**专题文档之间冲突时，以架构文档为准；本手册与专题文档冲突时，先更新专题文档，再改本手册。**

---

# 第一部分 · 开发流程规范

## 1.1 版本管理

**分支模型：trunk-based（主干开发）**

- 日常开发直接在 `main`，小步提交；
- 只有**破坏性/实验性**改动才开 `feat/<简短名>`，合完即删；
- 里程碑打 tag：`git tag -a v0.1.0 -m "MVP：三层模型 + 导入导出"`。

理由：单人（或极小团队）+ AI 辅助开发的场景，长期分支的维护成本远大于收益。

**提交规范：Conventional Commits**

| 类型 | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修复缺陷 |
| `refactor` | 重构（不改外部行为） |
| `perf` | 性能优化 |
| `test` | 测试 |
| `docs` | 文档 |
| `chore` | 构建、配置、脚本 |

作用域建议：`feat(person)`、`fix(event)`、`refactor(core)`、`chore(git)`。

**自动提交（已启用）**

`Stop` / `SessionEnd` 钩子会自动调用 `scripts/git-sync.sh`：有改动就提交并推送，无改动跳过。

```bash
bash scripts/git-sync.sh                        # 自动生成提交信息
bash scripts/git-sync.sh "feat(person): 属性分组" # 自定义信息（重要改动必须这么用）
bash scripts/git-remote.sh <仓库URL>             # 配置远程（一次性）
```

**铁律：每轮对话结束必须提交并推送。** 钩子失效时用上面的手动命令补齐（详见 `CLAUDE.md`）。

## 1.2 开发顺序原则

**固定顺序：数据模型 → 用例 → UI → 测试。不可跳步。**

```
① 表结构 + 迁移脚本      （先定数据长什么样）
② domain 实体与规则      （纯函数，零 IO）
③ repository 实现        （SQLite）
④ app-core 用例          （编排，UI 无关）
⑤ UI                     （最后做，只是数据的投影）
⑥ 测试                   （与 ②③④ 同步写）
```

理由：本软件的复杂度几乎全在**数据模型**（动态属性、嵌套集合、模糊时间、同步埋点）。UI 只是把数据投影出来，先做 UI 必然返工。

**任务粒度**：单个任务 ≤ 1 天，且必须能独立验证（跑得起来、看得见效果、测得动）。

## 1.3 代码规范

| 项 | 规范 |
|---|---|
| 文件命名 | `kebab-case.ts` |
| 类型/类 | `PascalCase` |
| 函数/变量 | `camelCase` |
| 常量 | `UPPER_SNAKE_CASE` |
| ID 前缀 | 人物 `p_`、事件 `e_`、集合 `c_`、附件 `att_`、设备 `d_` |
| ID 算法 | ULID（时间有序、字符串、离线可生成） |
| 时间存储 | **三件套**：ISO8601 字符串（展示）+ UTC 毫秒整数（索引排序）+ `hlc`（同步判定） |
| JSON 字段 | 读写走 schema 校验（Zod）；**未知字段保留，绝不丢弃** |
| 错误处理 | 用例层统一返回 `Result<T, DomainError>`，禁止吞异常、禁止空 catch |
| 日志 | 结构化日志，敏感字段脱敏后输出 |

**分层铁律（违反即打回）**

1. `domain` 层**不 import 任何 IO 库**（不碰 fs、网络、SQLite、日期的 `now()` 需注入）。
2. UI **不直接访问 SQLite**，只能调 `app-core` 用例。
3. 跨层依赖一律走**接口**（`SqlDriver`、`Repository`、`AiProvider`）。
4. `ai` 包**单向依赖 domain**，domain 永不依赖 ai。

## 1.3b 布局规范（手机优先）

**铁律：样式表只用 `min-width` 媒体查询。基准样式 = 手机，逐级增强。**

| 断点 | 形态 |
|---|---|
| base（<768px） | 单栏页面栈：列表 / 详情二选一，底部 Tab Bar + 悬浮 FAB |
| ≥768px | 表单与统计不再挤一列；弹窗回到居中卡片 |
| ≥1024px | 顶部栏 + 双栏并排（列表 320px + 详情自适应），Tab Bar 退场 |

**导航状态机**：`View` 联合体 `{list|detail|timeline|settings}`，由 `.app.at-<k>` 类驱动 CSS 显隐，
**不在 JS 里判断屏幕宽度**——宽屏在媒体查询里把「列表/详情同屏」的隐藏规则覆盖掉即可。
唯一例外是时间线筛选面板（需要 JS 知道是否展开），用 `matchMedia` 订阅。

**已踩的坑，别再踩**：

1. **属性选择器不要用引号**：构建压缩会把 `[data-view='list']` 压成 `[data-view=list]`，
   浏览器整段丢弃规则且不报错。改用普通 class。
2. **留空的 CSS 规则会吞掉后面的整段**：`.page-title {` 后面没内容时，紧随其后的
   `@media` 块会被解析成它的内部声明，媒体查询直接消失（不报错）。
3. **`display:none` 的 base 规则会压过媒体查询**：`.filter-body{display:none}` + base 后置的
   `{display:flex}` + 1024 块里的 `{display:grid}` —— 三者同权重时源码顺序决定，flex 获胜。
   折叠态要用**后代选择器**（`.pane-body:not(.filters-open) .filter-body`）收窄作用域。
4. **iOS 聚焦会缩放页面**：输入控件 `font-size` 必须 ≥ 16px（≥768px 才降回 13px）。
5. **390px 下两列表单会挤压日期/时间控件**：`.form-grid` base 是单列，≥768px 才两列。
6. **图标用内联 SVG，不用 emoji**：emoji 在部分安卓/Linux 上渲染成空心方框，且不跟随主题色。

**验收清单**：改动 UI 后必须跑 playwright 三视口实测——**390×844**（iPhone）、
**820×1180**（iPad）、**1440×900**（桌面），断言：无横向溢出、无控制台报错、关键元素可见性符合断点预期。

## 1.4 测试策略

| 层 | 测试类型 | 覆盖要求 |
|---|---|---|
| `domain` | 单元（vitest） | 整体 ≥ 80%；**属性系统、时间模型、合并逻辑必须 100%** |
| `schema` | 迁移测试 | 每个 `schemaVersion` 升级都要有用例（老数据能升、不丢字段） |
| `repository` | 集成（临时 SQLite） | CRUD + 索引命中 + 关联查询 |
| `io` | **往返测试** | 导出 → 导入，数据必须完全等价（这条最容易出隐性 bug） |
| `app-core` | 用例测试 | 主要成功路径 + 关键失败路径 |
| e2e | 关键流程 | 建人物 → 记事件 → 归集 → 导出 → 导入 |

## 1.5 Definition of Done（完成标准）

一个功能只有全部勾选才算完成：

- [ ] 按功能卡规格实现，**边界情况全部处理**
- [ ] 有对应测试（见 1.4 覆盖要求）
- [ ] 数据模型有变更 → **已写迁移脚本且 `schemaVersion` +1**
- [ ] 新增表/字段 → **同步埋点已加**（见附录 A）
- [ ] 错误路径有用户可见提示，不白屏、不静默失败
- [ ] 无 TS 类型错误、无控制台报错
- [ ] 本手册对应功能卡勾选为已完成
- [ ] 已提交并推送 git（`git status` 干净）

## 1.6 版本号与发布

- `0.x.x` 阶段：任何 API 可随意调整；`0.1.0` = MVP 可用。
- `1.0.0` = 数据格式稳定，承诺向后兼容（导入旧库必须可用）。
- 每次 tag 时在 `CHANGELOG.md` 补一条，格式：`## [v0.2.0] - 2026-10-20` + 新增/修复列表。

---

# 第二部分 · 功能规格

## 2.0 优先级总览

**P0 = MVP 必需｜P1 = 完整版｜P2 = 增强**

| 模块 | 功能 | 优先级 |
|---|---|---|
| 基础设施 | 项目脚手架、`SqlDriver`、迁移框架、ID/时间工具、oplog、日志 | P0 |
| 人物 | 创建/编辑/列表/详情、**动态属性系统**、属性定义管理、模板、归档 | P0 |
| 事件 | 创建/编辑/删除、**TimeSpec 时间录入**、参与者、metrics、正文与附件、时间线 | P0 |
| 事件集 | 创建/重命名、**嵌套移动**、成员增删排序、树导航、面包屑、集合统计 | P0 |
| 检索 | 全文搜索、结构化筛选（人物/标签/时间/评分） | P0 |
| 导入导出 | `.drp` 完整导出 / 导入（含附件） | P0 |
| 设置 | 数据目录、应用锁、导出备份 | P1 |
| 增强 | 属性历史曲线、统计看板、智能集合、撤销重做、模糊时间解析 | P1 |
| 隐私 | 本地库加密、敏感字段保护 | P1 |

---

## 2.1 基础设施

### F-B01 项目脚手架 — P0

- 用 pnpm workspace：`packages/core`（domain/schema/repository/io/app-core）+ `apps/web`（先做 Web 端）。
- TypeScript strict 模式，路径别名 `@core/*`。
- 验收：`pnpm build`、`pnpm test`、`pnpm dev` 三条命令全部跑通。

### F-B02 `SqlDriver` 抽象与 SQLite 实现 — P0

```ts
interface SqlDriver {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;
}
```

- 首版实现：Web 用 `wa-sqlite` + OPFS，桌面用 `better-sqlite3`，移动用 `op-sqlite`。
- **核心代码只允许依赖接口**，端差异压缩在适配层。
- 验收：同一套集成测试，换 driver 后仍能通过。

### F-B03 迁移框架 — P0

- `schemaVersion` 存库内（表 `meta`）。
- 迁移脚本链 `v1→v2→v3`，每个脚本一个文件 `migrations/002_add_oplog.ts`，带 `up`（可选 `down`）。
- 打开库时自动检测版本并顺序升级；升级前**强制自动备份**。
- 验收：拿 v1 的库文件打开 → 自动升到最新 → 数据无丢失（有迁移测试）。

### F-B04 ID / 时间 / HLC 工具 — P0

- `newId(prefix)` → ULID；`nowHlc()` → `毫秒:计数器:设备ID`，单调递增。
- `TimeSpec` 解析与格式化（见 F-E02）。
- 验收：HLC 在时钟回拨时仍单调递增；同一毫秒并发调用不重复。

### F-B05 oplog 写入 — P0

- 所有写操作（增删改）必须在**同一事务**内写业务表 + 追加 oplog。
- 提供 `withOplog(entity, op, fn)` 包装器，禁止裸写。
- 验收：任何一条数据变更都能在 oplog 里找到对应记录，且 `hlc` 有序。

### F-B06 日志与错误上报 — P1

- 结构化日志（级别、模块、耗时），敏感字段脱敏。
- 未捕获异常落本地日志文件，设置页可查看/导出。

---

## 2.2 人物模块

### F-P01 创建人物 — P0

- **数据**：`persons` 一行；按所选模板初始化 `attrs`。
- **交互**：「新建人物」→ 填 `displayName`（必填）+ 头像（可选）+ 选择模板（默认/恋人/朋友/同事/自定义）→ 创建后跳详情页。
  （模板下拉已随 F-P04 兑现；内置的「默认/恋人/朋友/同事」预置模板未做，用户在设置里自建。）
- **边界**：
  - `displayName` 重复 → 提示但**允许保存**（重名很常见）；
  - 未填名称 → 禁用创建按钮；
  - 切换模板 → **合并**字段，已有的属性值不删除。
- **验收**：创建后出现在列表；`attrs` 含模板字段；oplog 有 insert 记录。

### F-P02 属性定义管理 — P0（本软件的灵魂）

- **数据**：`attribute_defs(key PK, label, type, group, config_json, archived, updated_at)`。
- **交互**：设置页「属性字典」→ 新增/编辑/归档；选择类型后展开对应配置项（枚举选项、单位、评分上限、是否敏感、是否随时间变化）。
- **边界（必须实现）**：
  - `key` 创建后**不可改**；`label` 可随时改；
  - `type` **不可改**；确需变更 → 走「字段迁移向导」（新建 key → 批量转换 → 归档旧 key）；
  - **删除 = 归档（软删除）**，历史值全部保留；
  - 枚举类型**新增选项**不影响旧值；**删除选项**时已使用该选项的值保留但标记为"已失效选项"。
- **验收**：归档一个 def 后，旧人物的该字段仍正常显示；新建一个同名 key 会提示冲突。

### F-P03 属性动态渲染与编辑 — P0

- **数据**：`persons.attrs`（JSON），结构 `{"<key>": {"v": 值, ...元信息}}`。
- **交互**：详情页按 `group` 分区渲染；每个 type 对应一个控件（见架构文档属性类型表）；编辑即存（失焦保存）+ 可撤销。
- **边界**：
  - 空值**不写入**（保持 JSON 干净）；
  - `attrs` 中出现**未知 key** → 按 `json` 类型兜底渲染，**绝不丢弃**；
  - `sensitive` 字段默认打码（明文控件不渲染，点「显示」才展开，空闲 15 秒自动收起）；
  - 设了应用锁并解锁后，本会话不再逐字段打码（应用锁即二次认证）；
  - `computed` 类型只读（如年龄、见面次数）。
- **验收**：20 种类型全部能正确渲染、编辑、持久化；手改 JSON 加一个未知字段后 UI 不崩且能显示。

### F-P04 属性模板 — P1

- 模板 = 一组 def key 的有序集合；支持「应用到人物」（合并，不覆盖已有）、「从当前人物存为模板」。
- **做法**：`attribute_templates` 表（schema v3 新增，老库走 `runMigrations` 的 v<3 分支幂等建表）。
  「应用」= 把模板里**缺失**的 key 按类型播种空值（boolean→false、数值→0、多选→[]、其余→''），
  直接改 `attrs_json` 一次写完——不走 `setAttribute`，那是逐字段写历史，套模板不该在「属性变化」里刷空记录。
  已有值的字段一律不碰（合并语义）。
- **可见效果**：`PersonAttrs` 组内排序改成「已填字段按 attrs 插入序在前，未填按字典序在后」。
  套模板播种的字段会按模板顺序浮到前排——没有模板时插入序通常就是字典序，观感与以前一致。
- **入口**：新建人物时的内联创建区多一个模板下拉（F-P01 规格里写的「选择模板」至此兑现）；
  人物详情属性区有「套用模板 / 存为模板」；设置页「属性模板」管模板本身的增删改。
- **导入导出**：`.drp.json` 带 `templates` 字段（按 hlc upsert，老备份没有该字段按空处理）。
- **边界**：字典里被删/归档的 key 套用时静默跳过；模板软删除（和事件一套语义），已套过的人物不受影响。

### F-P05 属性历史 — P1

- `timeVarying: true` 的字段每次变更写入 `person_attr_history`；
- 详情页「属性变化」卡片：默认收起，展开后可按字段切换——数值型（number/money/rating）画 SVG 曲线，其余列时间轴；
- 待办：关联触发事件（`by_event_id` 已存但未展示）、"回看某一天的状态"。

### F-P06 人物列表 — P0

- 卡片/列表双视图；按标签、分组、归档状态筛选；按名称、创建时间、最近互动时间、任意属性字段排序。
- 显示关键统计角标：事件数、最近见面天数、平均评分。

### F-P07 人物详情 — P0

- 头部：头像、名称、别名、标签、关系状态；
- 属性分区（按 group）；
- **相关事件时间线**（倒序）；
- 统计：见面次数、总花费、平均评分、好感度曲线（P1）。

### F-P08 人物归档与合并 — P1

- 归档：软删除，列表默认隐藏，可恢复；
- 合并：选择重复人物 → 预览 → 合并属性（冲突字段逐个人工选择）+ 转移事件参与者引用。

### F-P09 人物图标 — P1

- `persons.icon_json`（schema v8，老库 `hasColumn()` 幂等补列）存与事件集同款的 `CollectionIcon`
  （`text` / `alpha` / `svg` / `image` + `fg` / `bg`）。**同一个 `IconPicker` 组件复用**，
  只通过 `onSave` 决定落到哪个实体上。
- **显示优先级**：自定义图标 → 老头像 `avatar`（`file:<id>`）→ 姓名首字。
  `Avatar` 组件把图标交给 `CollectionIconView` 渲染，外形仍保持圆形头像。
- **写入口 `setPersonIcon()`**：与 `setCollectionIcon()` 同构，幂等、单独 oplog，`null` 恢复默认。
- **文件引用一视同仁**：`personsUsingFile()` 同时匹配 `avatar` 与 `icon_json.fileId`；
  `fileStillReferenced()` 把人物图标算作引用；文件合并/改名时 `rewriteRefs()` 会改写
  人物图标与事件集图标里的 `fileId`，否则源文件一删图标就失效。

---

## 2.3 事件模块

### F-E01 创建事件 — P0

- **数据**：`events` 一行 + `event_participants` 多行 + `collection_members` 可选。
- **交互**：两种入口
  1. **完整表单**：标题、类型、时间、地点、参与者、正文、标签、metrics；
  2. **快速记录**（浮动按钮）：一行文本框 → 先用简单规则解析（暂不接 AI），生成草稿后确认。
- **边界**：无参与者时允许保存，但详情页提示"未关联人物"；标题为空则用正文首 20 字自动填充。
- **验收**：创建后同时出现在全局时间线、相关人物的时间线、所属集合中。

### F-E02 时间录入（TimeSpec）— P0

- 支持六种：`instant` / `interval` / `fuzzy` / `ongoing` / `recurring` / `unknown`。
- **交互**：时间选择器 + 「模糊」开关；模糊时输入原文（如"去年夏天"）并选精度（年/月/日）。
- **存储**：`time_json` 存完整语义；`start_ts` / `end_ts` 存 UTC 毫秒估算值，**专供排序与范围查询**。
- **边界**：
  - 模糊时间显示时带"约"字；
  - 排序**恒用 `start_ts`**，保证任何事件都能在时间线落位；
  - 跨时区的事件保留原始 `tz`。
- **验收**：`unknown` 事件也能插入时间线且不崩；区间事件跨月显示正确。

### F-E03 参与者管理 — P0

- `role`：`primary` / `companion` / `thirdParty` / `self`；
- 每个参与者可带 `note` 与 `perPerson`（自由 JSON，如她的心情、她付的钱）；
- **边界**：同一人物不可重复添加；删除参与者不影响人物本身。

### F-E04 度量录入（metrics）— P0

- 评分（1-5）、花费（金额+币种）、心情、亲密度增减；
- **边界**：币种默认 CNY；金额为 0 或空不报错。
- 验收：这些字段可被筛选，并聚合到人物/集合统计。

### F-E05 正文与附件 — P0

- 正文：Markdown，支持图片内联；
- 附件：存 `attachments` 表，**内容寻址（sha256 命名）**，天然去重；
- **边界**：删除事件不清空附件（引用计数归零才清理）；附件丢失时 UI 显示占位符而非崩溃。
- **做法**：一条文件引用的「主」有四处——事件正文里的 `file:<storedId>`、事件的 `media_json`、
  人物头像 / 人物图标（`persons.avatar` / `persons.icon_json`）、事件集图标（`collections.icon_json`）。
  引用计数归零的自动回收**只发生在彻底删除事件**（`purgeEvent` → `sweepEventFiles`，见 `core/repo/fileGc.ts`）：
  软删除不回收（回收站里的事件随时可能恢复，恢复了引用又回来了）；
  编辑正文丢引用也不自动删——IndexedDB 里的二进制删了就真没了，整库快照式撤销只覆盖 SQLite 那一份、救不回 blob，
  所以这种情况由文件管理里的「未被引用」标出来让人自己决定。
- **边界**：回收在 purge 的事务内发裸 SQL（sql.js 事务不可重入），blob 的删除在事务外异步补刀——IndexedDB 写失败只是多留一份孤儿二进制，下次扫描还能看见。

### F-E06 事件时间线 — P0

- 全局时间线按月分组、虚拟滚动；
- 筛选：人物、标签、类型、时间范围、评分、集合；
- **性能要求**：1 万条事件下首屏 < 200ms（靠索引 + 分页）。

### F-E07 编辑与删除 — P0

- 删除 = 软删除（`deleted_at`），进回收站，可恢复；
- 编辑后 `rev +1`、更新 `hlc`、写 oplog。

### F-E07a 浏览态与编辑态 — P1

- 打开已有事件默认进入**浏览态**（`EventView`）：标题 + 隐私标记，时间/类型/地点/评分/花费/心情/亲密度
  收成一行紧凑小字；人物、事件集、标签、关联各占一行 chip；正文用 `MarkdownView` 渲染，没有正文时显示占位。
- 浏览态底部只有「删除 / 关闭 / 编辑」，点「编辑」切到编辑态；新建事件直接进入编辑态。
- 编辑态保留 `MarkdownEditor` 的「编辑 / 预览」切换，正文可以在不离开表单的情况下预览。
- **做法**：模式是 `EventForm` 内的局部 `mode` state，不落库；浏览态复用 `formatTime` 等已有格式化函数，不新增数据路径。
- **布局约束**：事件弹窗在 390px 宽度下不得横向溢出——`.md-toolbar` 改为 `flex-wrap` 两行、
  `.form-grid > *` 与 `.md-editor` 加 `min-width: 0`（grid 子项默认 `min-width:auto` 会被不换行的工具栏撑宽）；
  事件集 chip 的层级缩进只用 `paddingLeft`（`11 + depth * 9`），不加 `└` 之类符号——
  符号自身占宽再加 `gap`，文字左边会凭空多出一段空当。

### F-E08 事件关联 — P2

- `followedBy` / `causedBy` / `sameDay` 轻量有向边，详情页展示上下游。
- **做法**：单向边，存在 `events.related_json`（`[{type, targetId}]`，该列 schema 里早有、此前是死列）。
  写入走 `EventInput.relatedEvents`，`createEvent` / `updateEvent` 都序列化它；读取时 `eventFromRow` 早就会解析成 `DREvent.relatedEvents`。
- **UI**：事件编辑框里「关联事件」字段——搜索标题加点（默认「后续」，可下拉改成「起因 / 同日」），已关联的行可改类型、可移除；
  反向关联（「被以下事件关联」）由全表扫描得出，只读展示，不落库。时间线行有 `🔗n` 角标。
- **边界**：不能关联自己、同一目标只保留一条；软删除目标后链接保留（回收站可恢复，恢复了还能看见），
  但**彻底删除**会用 `stripRefsTo()` 把别人 `related_json` 里指向它的条目摘掉，不留下「（已删除的事件）」死链。
- **未做**：关联图谱可视化；`sameDay` 只是一个人工标记，不会按日期自动补全。

---

## 2.4 事件集模块

### F-C01 创建与重命名 — P0

- 字段：名称、类型（`timeline`/`arc`/`topic`/`project`）、描述、封面、状态。

### F-C02 嵌套与移动 — P0

- **MVP 用单父树**（`parent_id`）+ 闭包表 `collection_closure`。
- 移动时：**必须做环检测**（不能把父集合移进自己的子孙）；移动后**重算闭包表**。
- **边界**：移动到根 → `parent_id = null`；移动后所有子孙的闭包关系一次性重建（事务内完成）。
- 验收：移动后，祖先路径下仍能查到该集合的深层事件。

### F-C03 成员增删与排序 — P0

- `collection_members(collection_id, member_type, member_id, order_key)`；
- **`order_key` 用 fractional index 字符串**（不是整数）；
- 成员可以是事件，也可以是子集合；
- **边界**：删除成员只删关联，不删实体；一个事件可属于多个集合。

### F-C04 智能集合 — P1

- `rule_json` 条件表达式（人物、标签、评分、时间范围）；
- 查询时**动态求值**，不落库，永远不遗漏新事件。
- **已兑现（本版）**：`CollectionKind` 新增 `'smart'`，规则用 `SmartRule`（关键词 / 标签 / 类型 / 人物 / 最低评分 / 最近 N 天）
  ——刻意做成 `EventFilter` 的子集，`ruleToFilter()` 直接翻译成 `listEvents()` 的入参现算，
  所以「新事件满足条件自动进集合、事件被删自动消失」是语义保证，不需要任何同步逻辑。
  树内联创建多一个「普通/智能」下拉，智能行带 `⚡` 徽标；详情页换成「命中事件」卡片 + 「编辑规则」弹窗
  （六个条件 + 实时命中数预览，空规则禁止保存），普通集合的「添加事件」对智能集合不出现。
  新建智能集合进详情页会自动弹出规则编辑（空规则 = 全库，先问清楚条件）。
- **边界**：`addMember` 对智能集合直接短路（成员是算出来的，手动挂下一秒就被覆盖）；
  `updateCollection` 把普通集合改成智能时会清空它的手动成员（`collection_members` 软删）。
  导入导出走 `.drp.json` 的 `rule` 字段（按 hlc upsert），老备份没有该字段按 null 处理。
- **未做**：规则组合的「且/或」分组（当前六条件是 AND 平铺）；按集合规则反查「为什么这个事件没进来」。

### F-C05 树导航与面包屑 — P0

- 左侧可折叠树；顶部面包屑显示嵌套路径；支持拖拽移动（P1）。

### F-C06 集合详情与统计 — P0

- 成员列表 + 时间跨度（**默认由成员推导**，允许手动覆盖）+ 聚合统计（事件数、总花费、平均评分）。

### F-C07 集合删除 — P0

- 软删除；**只解绑成员关联，绝不级联删除事件**（这是最容易出事的地方）。

### F-C08 集合图标 — P1

- `collections.icon_json`（schema v5，老库靠 `hasColumn()` 幂等补列）存 `CollectionIcon`：
  ```ts
  { type: 'text' | 'alpha' | 'svg' | 'image', text?, fileId?, fg?, bg? }
  ```
- **四种图标共用同一个方块外形**，只有内容不同：`text` 取 1 个字符、`alpha` 取 2 个、
  `svg` / `image` 绑一个 `attachments.id`。尺寸只有 sm(22) / md(32) / lg(48) 三档，
  够用且不容易在列表里对不齐。取字用 `Array.from()` 而不是 `.slice()`——
  emoji 是代理对，按 UTF-16 码元切会切出半个字符。
- **svg 走 `<img src=objectURL>`，绝不内联进 DOM**：用户上传的 SVG 可能带 `<script>`，
  内联等于把执行权交出去；`objectURL + <img>` 是浏览器隔离的渲染上下文。
  svg 用 `object-fit: contain`（留白是设计的一部分，cover 会切掉线条），位图用 `cover`。
- **文件引用要能看见**（用户明确要求）：图标落库存的是文件 **id**，所以
  - 「设置 → 文件」的行上显示 `N 个图标`，点开引用弹窗有「事件集图标」小节，写着「被「X」用作图标」；
  - 删除确认文案会带上「N 个事件集（X、Y）用它当图标」；
  - 孤儿回收 `fileStillReferenced()` 必须把 `collections.icon_json` 算作一处引用，
    否则「换个图标」会把图片当孤儿删掉（二进制进了 IndexedDB 就救不回来）。
- **`collectionsUsingFile()` 故意不过滤隐私**：它回答的是「还有谁在用这个文件」，
  被隐私集合用着的文件仍然算被引用；若在这里做隐私过滤，一开隐私模式就会把它判成孤儿。
- **写入口单独一个 `setCollectionIcon()`**：图标是纯展示属性，走 `updateCollection`
  会把名称/状态/成员一起惊动，撤销提示条也会说成「修改事件集」。它自带幂等
  （值没变就不落 oplog），传 `null` 表示恢复默认外观（浅粉底 + 主色首字）。
- **图库分栏只看 MIME**：`svg` tab 收 `image/svg+xml`，`image` tab 收其余 `image/*`，
  同一张图不会两边都出现；保存前还会再查一次文件是否还在库里
  （上传到保存之间有 500ms 持久化窗口，期间被回收就明确报错而不是存个空方块）。

### F-S01 隐私模式 — P1

- 人物 / 事件集 / 事件 / 文件四类实体各带一个 `is_private`（schema v4），
  标记入口分别是详情页顶栏按钮、事件表单里的开关、文件行的图标按钮。
- **隐私模式**是查看偏好（`localStorage: dr.privacy.mode`），开启后所有标了隐私的条目
  从列表、详情、统计里消失；参与者列表里的人名脱敏为「（隐私）」。
- **实现要点**：过滤发生在**仓储读取层**（`listPersons` / `listEvents` / `getTree` / `listMembers` /
  `listFiles` / `statsOf` / `globalStats` 在 `isPrivacyMode()` 时补一条 `is_private = 0`），
  不是在各组件里各判一次——这样新增查询自动继承，不会漏。切换模式必须 `bump()`，
  否则列表 memo 在旧版本号上，藏起来的东西会「藏在缓存里」。
- **边界**：`Panes` 把「私有 + 隐私模式」的选中项当**未选中**处理，所以详情区直接退回空态，
  比在详情内部报「已隐藏」更彻底；`PersonDetail` / `CollectionDetail` / `EventForm` 内还有一层兜底守卫。
  `setXPrivate` 一律**幂等**（值没变就不写 oplog），否则新建事件收尾时那次无害调用会
  让提示条从「新建事件」变成「修改事件」，撤销还得按两次。
- **未做**：生物识别解锁（WebAuthn，对纯本地库意义有限）。

### F-S02 设置目录的组织方式 — P1

- **两态 + 分组**：手机端目录页 / 子页二选一（`data-sub` 驱动 CSS），宽屏左目录右内容。
  目录按 `SETTINGS_ENTRIES[].group` 分成 **通用 / 安全 / 人物 / 数据** 四段，
  每段有小标题 + 图标，每条入口有 20px 线性 SVG 图标（`navIcons.tsx`，不用 emoji——
  部分安卓会把 emoji 渲染成空心方块，也没法跟随 `currentColor`）。
- **按「做一件事」合并入口**（合并只动「进哪一页」，页内仍是独立卡片）：
  | 合并后 | 原来分散的入口 |
  |---|---|
  | 隐私与安全 | 应用锁 · 本地库加密 · 隐私模式 |
  | 人物与属性 | 属性字典 · 属性模板 · 重复人物 |
  | 数据与统计 | 库概览 · 示例数据与重置 |
- **目录即状态**：「隐私与安全」那条的说明文字不给固定文案，而是现算
  `锁开/关 · 加密开/关 · 隐私模式开/关`——不进去也知道开没开。
- **旧 key 兼容**：`LEGACY_KEYS` 把 `lock` / `enc` → `security`、`templates` → `attrs`、
  `overview` / `sample` → `data`，`Settings` 的 `initial` 走 `resolveSettingsKey()`。
- **回归脚本的坑**：合并后同一页里会出现两套 `.lock-form` / `.lock-err` / `.card`，
  旧脚本里所有裸选择器都会撞上 strict mode。定位卡片要用
  `page.locator('.card').filter({ has: page.locator('.card-title', { hasText: /^标题$/ }) })`
  ——`hasText` 会**回溯到共同祖先**，两张卡都会被选中。

---

## 2.5 检索

### F-S01 全文搜索 — P0
FTS5 + `unicode61`，覆盖事件标题/正文/标签、人物名/别名；中文需分词预处理。

### F-S02 结构化筛选 — P0
人物 + 标签 + 时间范围 + 类型 + 评分 + 花费，可组合。

### F-S03 语义搜索 — P2
见 AI 能力 A15（需 embedding 索引）。

---

## 2.5b 日历

### F-V01 月视图日历 — P1

- **格子上方日期、下方事件集图标**；一格最多摆 3 个图标，多出来的收成 `+N`。
  只给「有事件」的格子放图标，空日子留白——给每个集合都撒一遍反而看不出哪天有事。
- **三种底色就是全部状态**：过去灰（`#eeece8`）、今天黄（`#ffe08a` + 内描边）、将来白。
  不标图例也不给每格描边，7 列的小格子多一根线就够乱了。
- **日界一律用本地时间**：`dayKeyOf()` 自己拼 `YYYY-MM-DD`，不用 `toISOString()`——
  后者按 UTC 切，东八区的人晚上 8 点后会"穿越"到第二天。
- 周一起排，前补到周一、后补齐整周，所以格子数永远是 7 的倍数（28/35/42），
  不会出现半行空洞。上下月补位的格子淡出但仍可点。
- **点某一天 → 时间线只看那天**：`pickDay()` 把 `fromTs/toTs`（当天 00:00:00 – 23:59:59.999）
  塞进 `TimelineFilter`，清掉其它条件（两个筛选打架时用户会以为数据丢了）。
  时间线标题旁出现「只看 2026-10-22」和「取消日期」，日历本身不另起一套事件列表。
- 事件归属集合取 `collectionsOfEvent()`；一条事件没挂任何集合时用
  `primaryCollectionId` 兜底，否则手动建的集合还没加成员，日历上就一片空白。
- **区间事件逐日展开**：1→3 号的事，1、2、3 每格都计数、都挂图标（`dayKeysBetween` 逐日推进）。
  `endTs` 缺失/非法/早于 `startTs` 时退化为单日；异常超长区间最多展开约 10 年，防卡死。
  日键推进用本地零点构造 `Date` 再 +1 天，跨月/跨年自动进位，仍不走 `toISOString()`。
- **跨天事件横条（SpanBar）**：单日事件不画条，仍用格子图标；跨天事件在所属周的日期格下方
  画一条横跨多列的色条（`collectSpanBars` → 月内裁剪 → 贪心分配 `lane`，先长的后短的，
  同一行不重叠）。跨周事件每周各画一段、首尾相接；跨月事件只画本月部分，被裁的端点显示
  ◀/▶ 延续箭头。点条 → 与点格子相同，回时间线只看那天。条内显示集合图标（复用
  `CollectionIconView`）+ 标题，超长省略。
- **筛选（人物 / 事件集）**：月卡片上方两枚胶囊按钮，点开是多选弹窗（手机 390px 放不下内联多选）。
  `CalendarFilter { personIds, collectionIds }` 在 `Calendar` 层持有，切月份不丢；
  组内 OR、组间 AND；事件集筛选走闭包表 `descendantIdsOf()`，选父集合自动含全部子孙。
  `collectDaySummaries(filter)` / `collectSpanBars(month, filter)` 共用 `makeMatcher()`——
  判定放在日期展开之前，被过滤的事件既不计数也不出图标、不出横条；空数组 = 不筛选。
  筛选只影响显示，不改数据，也不影响「N 天有记录」之外的时间线内容。
- **导航**：手机端底部 5 个 tab（人物 / 事件集 / 时间线 / **日历** / 设置），
  桌面顶栏 5 个页签；日历排在时间线和设置之间，正好居中。
- 回归脚本的坑：`.cal-cell` 的底色要用 `getComputedStyle().backgroundColor` 断言
  （`rgb(255, 224, 138)` 这种），别去比对 class 名——三种状态的类名都在，只有底色不同。

---

## 2.5c 同步与 AI

### F-S01 坚果云增量备份 — P1

**为什么不是「上传整份 .drp.json」**：一次改动哪怕只改一个字，整份 JSON 的字节都会挪位，
网盘只能整份重传。坚果云按流量计费，这条直接决定同步一次花多少上行。

**分片 + 内容寻址**：快照切成 64KB 定长片，文件名 = `sha256(片).slice(0,32)`。
内容没变 → 名字没变 → 云端已有 → 跳过。改一行字通常只让 1 个分片换名字。

| 文件 | 职责 |
|---|---|
| `core/sync/sha256.ts` | 纯 JS 增量 SHA-256。`crypto.subtle` 是一次性的、且纯 http 局域网下不可用 |
| `core/sync/chunk.ts` | `CHUNK_SIZE = 64KB`、`hashChunks`、`digestOf`（整库摘要） |
| `core/sync/manifest.ts` | 远端清单结构 + `knownHashes` / `missingChunks` |
| `core/sync/snapshot.ts` | 快照生成 + **稳定序列化** |
| `core/sync/webdav.ts` | MKCOL / PROPFIND / PUT / GET / DELETE + Basic 认证 |
| `core/sync/mergeRows.ts` | 远端快照 → 本地（按 hlc 合并，与 `importLibrary` 同一套规则） |
| `core/sync/engine.ts` | 三方比对 + 只传变化分片 |

**三方比对**（baseline = 上次同步成功时的 digest）：

| local vs baseline | remote vs baseline | 动作 |
|---|---|---|
| 相同 | 相同 | noop，一个字节都不传 |
| 相同 | 不同 | 只下载 |
| 不同 | 相同 | 只上传 |
| 不同 | 不同 | 先合并再上传（`action: 'both'`） |

**稳定序列化是这套方案的前提**。踩过的两个坑：

1. `buildLibrary()` 里 `meta.exportedAt` 每次都是新时间 —— 数据一字未改，分片哈希全变，
   增量直接退化成整库重传。所以 `stableJson()` 删掉 `meta.exportedAt`。
2. `meta.id` 原来是 `getMeta('library_id') ?? newId('lib')`，而**没有任何地方写入 `library_id`**，
   于是每次导出都生成新 id。已修为首次生成即落库。

`stableJson()` 同时把键按字母序排（对象字面量的 key 顺序会随代码改动漂移），
并剔除顶层 `meta` 里的 `id / deviceId / exportedAt` —— 它们属于「这份备份是谁导的」，
不是数据内容。

**其它约定**：
- 凭据（`nutstore.*`、`ai.key.*`、`lock.*`、`enc.*`）由 `SECRET_META_PREFIXES` 在生成快照时剔除，
  云端永远拿不到密钥；`containsSecret()` 是给回归脚本做自检用的。
- 附件二进制**不进**日常同步（`kind: 'lite'`）。它天生内容寻址、不会变，塞进来只会让首次同步
  推几十 MB，后续每次本地白算哈希。
- 远端快照只留最近 10 份，`pruneSnapshots()` 按文件名排序淘汰。
- **坚果云不返回 CORS 头**，网页直连必被浏览器拦。所以 `DavConfig.base` 可配置，
  测试时用本地转发代理（`proxy.mjs`）绕过。

#### F-S01b 跨域代理（tools/nutstore-proxy）

浏览器直连 `dav.jianguoyun.com` 会被同源策略在发请求前拦掉（报 `Failed to fetch`）。
AI 服务商能连，是因为它们**主动返回** `Access-Control-Allow-Origin`——纯属服务端配置差异，
客户端代码无法绕过。

代理做的事：把请求原样转发给坚果云，再**自己补上 CORS 头**。仓库 `tools/nutstore-proxy/` 提供两份零依赖脚本：

| 文件 | 部署目标 | 说明 |
|---|---|---|
| `worker.js` + `wrangler.toml` | Cloudflare Workers（免费） | `wrangler deploy` 即得 `*.workers.dev` 地址，App 里填 `https://<名>.workers.dev/dav` |
| `server.mjs` | 本地 / 自有服务器（Node） | `node server.mjs`，填 `http://<机器IP>:8787/dav` |

> **关于「放 GitHub 上」**：GitHub Pages 是纯静态托管，没有服务端逻辑，没法给请求加 CORS 头，
> 因此它本身当不了代理。脚本可以放在 GitHub 仓库里管理，但运行时要部署到 Cloudflare Workers
> 或一台能跑 Node 的小机器。代理不存账号密码，Basic Auth 头由浏览器带来、原样转发。

**回归**：`t-sync.mjs`（拦截 `dav.jianguoyun.com`，内存里跑真 WebDAV）20 项；
`t-sync-real.mjs`（真坚果云 + 转发代理）6 项；`t-sync-secret.mjs` 验证密钥不进云端。

### F-AI01 AI 模型别名 — P1

- 一行 = 一个「别名 → 怎么调」：`alias / provider / baseUrl / model / temperature / maxTokens / capabilities`。
  同一个模型可起多个别名配不同温度（「快速」0.2 / 「发散」1.0）。
- 服务商三个：**硅基流动**（根地址固定，UI 不出现「API 根地址」框）/ **OpenAI 兼容·第三方端点**
  （DeepSeek、Moonshot、OpenRouter、自建网关都填这里，出现可编辑的根地址框、默认 `api.openai.com/v1`）/
  **本地 Ollama**（默认 `localhost:11434/v1`，可改成远程/隧道）。
  早期版本把「OpenAI 兼容」和「自定义」拆成两项，实测二者等价（都是填一个 `/v1` 根地址），已合并；
  历史数据 `provider='custom'` 在 `providerOf` / `rowToModel` 里映射成 `openai`，无需迁移。
- 切换服务商时，根地址**重置为该服务商的默认值**（硅基流动则为空）——避免从上一家带出错误地址。
- 密钥框跟随当前所选服务商出现（硅基流动 / OpenAI 兼容需要，本地 Ollama 不需要），
  密钥按 **provider** 存一份（`meta['ai.key.<provider>']`），多条别名共用；
  存 `ai_models` 表里的只有「怎么调」，所以配置能随备份/同步走而密钥留在本机。
- 「密钥」区是**按需出现**的：只展示「被某个模型用到」或「当前正在编辑的服务商」的密钥框，
  不会一上来列一堆用不上的。
- 能力标签 `capabilities`（文本 / 图片 / 视频 / 音频 / 文件）记在 `ai_models` 表里，
  不同功能按能力挑模型（看图要「图片」、转写要「音频」）。
  **关于「读取列表时自动带出能力」**：标准 `/v1/models` 接口（硅基流动、OpenAI、DeepSeek、Moonshot…）
  只回 `{id, object, created, owned_by}`，**没有能力字段**——这点已用真实 SiliconFlow 返回验证过，
  所以能力只能手动勾选。代码里 `normalizeCaps()` 仍会解析任何返回 `capabilities` 的服务商
  （如 OpenRouter 的 `vision`/`speech` 别名已映射），命中即自动预填，否则提示手动勾选。
- 只依赖两个端点 `/v1/models` 与 `/v1/chat/completions` —— 硅基流动、OpenAI、DeepSeek、
  Ollama、自建网关全覆盖，一套代码。Ollama 的 `/v1/models` 也是 OpenAI 风格 `data[].id`，
  `listRemoteModels` 两种形状（OpenAI 风格 `data[]` / Ollama 原生 `models[]`）都兜。
- 「读取模型列表」「测试这个模型」的反馈**直接显示在按钮下方**（同区块内），不再飘到页面顶上；
  成功/失败都给明确文案（失败会区分 401 密钥失效 / 404 地址错 / 429 限流 / 网络或被跨域拦）。
- 别名唯一性在写入时校验（`assertAlias`），合并时也校验：本地已被别的 id 占了同名别名就跳过，
  避免同步出两个「便宜好用的」。
- `deleteModel()` 删掉默认模型时会顺手把下一个顶为默认，「默认模型」不会变成空指针。
- schema v7：在 v6 的 `ai_models` 表上 `ALTER` 加 `capabilities` 列（幂等）；`CREATE TABLE` 也带上该列。

**回归**：`t-ai.mjs`（真硅基流动）14 项 ；`t-ai2.mjs` 13 项（地址自动填充/隐藏、能力勾选与持久、
读取成功与失败反馈、刷新后仍在、密钥区按需出现）。

---

## 2.6 导入导出

### F-I01 `.drp` 导出 — P0

```
dating-record-YYYYMMDDHHmm.drp.zip/
├── library.json       # 全部结构化数据（含 schemaVersion）；附件只留元数据，不含 base64
├── attachments/       # 附件原文件二进制，按内容寻址的 storedId 命名
└── manifest.json      # 格式版本（drp/1）、导出时间、附件清单（id → 包内路径）
```

默认导出 zip：附件以原文件存放（不再 base64 +33%），JSON 文本压缩，体积显著小于内联 JSON，
方便传网盘/同步。附件二进制本身不二次压缩（图片/视频已压缩，store 即可）。
**仍保留 `.drp.json` 导出**（纯文本、可 diff、可进 git），设置页有独立按钮。
边界：敏感字段**默认不导出**或按开关脱敏；导出前校验 JSON 可序列化；元数据在但二进制丢失的附件跳过，不阻断备份。

### F-I02 `.drp` 导入 — P0

- **两种载体都认**：`.drp.zip`（走 manifest 找附件）与旧的 `.drp.json`（附件 base64 内联），按 zip 魔数自动识别；
- 校验 `schemaVersion`，自动跑迁移链；
- 两种模式：**合并到现有库 / 替换**（替换前自动导出一份 zip 备份）；
- 冲突策略：同 ID 且 `hlc` 更新 → 覆盖，否则保留并提示。

### F-I03 往返测试 — P0

导出 → 导入 → 数据完全等价（自动化断言，见 1.4）。

---

## 2.7 设置与隐私

| ID | 功能 | 优先级 |
|---|---|---|
| F-X01 | 数据目录选择、自动备份快照 | P1 |
| F-X02 | 应用锁（口令 + 空闲自动锁，已实现；生物识别未做） | P1 |
| F-X03 | 本地库加密 + 恢复码（已实现，见下） | P1 |
| F-X04 | 敏感字段二次认证展示（已实现打码，应用锁可作二次认证） | P1 |
| F-X05 | 撤销 / 重做（已实现，见下） | P1 |
| F-X06 | 本地库加密 + 恢复码（已实现，见下） | P1 |

### F-X05 撤销 / 重做 — P1
- **做法**：整库快照式。每次「动作」前 `db.export()` 存一份，撤销 = `new sql.Database(旧字节)` 换回实例 + `flushPersist()`。
  选它而不逐行记 before/after，是因为写入口有 44 处，而持久化本来就要整库 export——一次快照就是一次 memcpy。
- **合并窗口**：连续两次写间隔 < 1.5 秒并成一步（表单逐字段保存、连点星星不该撤销三次）。
  窗口按「上次写入」计时；撤销 / 重做 / 批量操作之后强制开新步。
- **上限**：40 步 / 24 MB，超出先淘汰最旧。附件二进制在 IndexedDB 独立 store、不进快照，附件行从不物理删除，换回旧实例不会悬空。
- **入口**：动作后飘提示条（带「修改人物「林晚」」这类标签，来源是 oplog 行），`Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Shift+Z` 重做；输入框内不拦（那是浏览器自带的文本撤销）。
- **边界**：快照只在内存里，刷新即失效；导入 / 示例数据 / 迁移这类批量操作只记首尾一步。

### F-X06 本地库加密 + 恢复码 — P1

- **做法**：应用层加密，不是 SQLCipher（sql.js 没有对应的 WASM 构建）。加密对象是 `db.export()` 出来的整库字节，
  落地时 IndexedDB 里存的是密文记录 `main.enc`，明文 `main.sqlite` 被删掉。
- **密钥结构**：随机生成 32 字节主密钥加密整库；口令经 PBKDF2-HMAC-SHA256（12000 次迭代，纯 TS）派生一把钥匙把主密钥包住，
  恢复码同样派生一把再包一份。两把钥匙各自独立——忘一个还有另一个。改口令只重包主密钥，整库密文不动。
- **模式**：AES-256-CTR（纯 JS 的 aes-js，已按 NIST SP 800-38A 官方向量核对）+ Encrypt-then-MAC（HMAC-SHA256 覆盖密文）。
  不用 GCM：纯 JS 的 GHASH 容易写错，而 CTR + 独立 HMAC 更容易验证正确。
- **恢复码**：5 组 × 5 字符 Crockford base32（去 I/L/O/U，≈125 bit 熵），只显示一次，且必须照着打一遍确认抄对才让加密生效。
- **与应用锁的关系**：加密开着时，开机那一次输入同时算应用锁解锁，口令由「本地库加密」一处管理；
  关闭加密会连带清掉应用锁口令。会话主密钥只在内存里，刷新即丢——防的是「磁盘上那份文件」，不是「正开着的页面」。
- **边界**：不防「把旧密文换回来」的回滚攻击（需要能本地改文件的攻击者，超出威胁模型）；
  附件二进制仍明文存在 IndexedDB 的 `blobs` store 里——加密的是数据库本身，见 F-E05 的待办。

---

# 第三部分 · 未来功能路线图

| 版本 | 内容 | 依赖 |
|---|---|---|
| **v0.1 MVP** | 本手册全部 P0 | — |
| **v1.0** | 全部 P1：属性历史曲线、统计看板、智能集合、撤销重做、应用锁、本地库加密 | MVP |
| **v1.5** | **跨端**：`core` 抽包 + 第二个端（Web/移动）跑通；关系图谱（人物关系第四层） | 存储同步篇 |
| **v2.0** | **同步备份**：oplog 交换 + 对象存储/WebDAV + 端到端加密 + 冲突 UI | 存储同步篇 |
| **v2.5** | **AI-1**：速记结构化、时间解析、自动标签、摘要、语义搜索、RAG 问答 | AI 篇 |
| **v3.0** | **AI-2/3**：承诺伏笔、雷区清单、回顾报告、关系健康度、模式识别、话术草稿、关系传记 | AI 篇 |
| **v3.5** | 事件集多父 DAG、AI-4（聊天记录解析，默认本地模型） | — |

**AI 能力完整清单（31 项）见 `dating-record-ai-capabilities.md`；同步与跨端细节见 `dating-record-storage-sync.md`。**

---

# 附录

## A. 同步埋点 Checklist（新增任何表/字段时逐项确认）

- [ ] 主键是 **ULID**，不是自增整数
- [ ] 有 `device_id`（最后修改设备）
- [ ] 有 `rev`（本地修改计数）
- [ ] 有 `hlc`（混合逻辑时钟，全局可比较）
- [ ] 有 `deleted_at`（**软删除墓碑**，永不物理删除）
- [ ] 顺序字段用 `order_key` **字符串**（fractional index），不是整数
- [ ] 写操作通过 `withOplog` 包装，**业务表与 oplog 同事务**
- [ ] 附件走**内容寻址** sha256

> 漏掉任何一项，将来加同步都要付出迁移历史数据的代价。

## B. 常用命令

```bash
bash scripts/git-sync.sh "feat: 描述"     # 提交并推送
bash scripts/git-remote.sh <URL>          # 配置远程仓库
bash scripts/deploy-pages.sh              # 构建并发布到 gh-pages
git tag -a v0.1.0 -m "MVP"                # 打版本标签
git status                                # 确认工作区干净
```

**发布说明**：本仓库 GitHub Pages 源是「**从分支部署（gh-pages）**」，
所以**不能**用 `actions/deploy-pages`（它要求 Pages 源为 GitHub Actions，deploy job 必失败）。
`.github/workflows/deploy-pages.yml` 与 `scripts/deploy-pages.sh` 都走同一条路：
构建 → 用 `dist` 覆盖 `gh-pages` 分支（含 `.nojekyll`）。

**改动 UI 后务必先本地验证再发布**：`pnpm build` 后起个静态服务（如
`python3 -m http.server 4191 -d dist`），用 playwright 跑三视口实测。

## C. 待决策事项汇总

| # | 问题 | 出处 | 状态 |
|---|---|---|---|
| 1 | 运行形态（桌面 / Web / 移动 / 全端） | 架构篇 §13 | ⏳ 待定 |
| 2 | 主存储方案 | 架构篇 §7 | ✅ 已定：SQLite + JSON 列 |
| 3 | 事件集嵌套模型 | 架构篇 §5 | ✅ 已定：MVP 单父树 + 闭包表 |
| 4 | 属性历史是否支持 | 架构篇 §3 | ✅ 已定：支持（P1） |
| 5 | AI 模型走本地还是云端 | AI 篇 §6 | ✅ 已定：浏览器直连各家 /v1（密钥只存本机） |
| 6 | AI 产出自动改写 or 逐条确认 | AI 篇 §6 | ⏳ 待定（建议：低风险自动，高风险确认） |
| 7 | 跨端技术栈（TS 核心 / Flutter / Rust） | 存储同步篇 §11 | ⏳ 待定 |
| 8 | 同步载体（对象存储 / WebDAV / 网盘） | 存储同步篇 §11 | ✅ 已定：坚果云 WebDAV + 内容寻址分片（见 F-S01） |
| 9 | Git 远程仓库地址与认证 | — | ✅ 已配置：`origin → git@github.com:totooicu/DatingRecord.git`（SSH 已实测可用；HTTPS 亦可用） |
