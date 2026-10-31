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

## 0.1 术语（话术）统一

界面文案、提交信息、文档、issue 描述一律使用下表词汇，不再自造同义词。

### 页面层级

| 术语 | 定义 | 代码对应 |
|---|---|---|
| **主页** | 底部 Tab 的一级页面，只指四个：人物主页、事件集主页、时间线主页、日历主页。详情页**不叫**主页。 | `view.k === 'list' \| 'calendar'` 等 |
| **人物主页** | 「人物」Tab 的根页面，列出全部人物 | `PersonList` |
| **事件集主页** | 「事件集」Tab 的根页面，树形列出事件集 | `CollectionTree` |
| **时间线主页** | 「时间线」Tab 的根页面，按时间倒序列出事件项 | `Timeline` |
| **日历主页** | 「日历」Tab 的根页面，月视图，含日期框与事件项 | `MonthView` |
| **设置主页** | 「设置」Tab 的根页面，列设置项（目录） | `SettingsNav` |
| **设置子页** | 在设置主页点某个**设置项**后进入的页面，标题就是该设置项的名字 | `Settings` 的 `data-sub` 态 |

### 条目（可点击的最小单元）

| 术语 | 定义 |
|---|---|
| **人物项** | 人物主页列表里的一行人物（头像 + 姓名 + 副信息） |
| **事件集项** | 事件集主页树里的一个节点 |
| **事件项** | 表示「一件事」的可点击单元。时间线主页的每一条、日期框里的每一条、人物详情与事件集详情里列出的每一条，都叫事件项；不叫「事件条目」「事件卡片」「记录」 |
| **日期框** | 日历主页里代表某一天的方格，每格显示日期数字，事件项以横条形式绘在日期框之上 |

### 详情页

| 术语 | 进入方式 | 同一概念的其它说法 |
|---|---|---|
| **人物详情** | 人物主页点**人物项** | 「人物资料」「人物信息」是口语同义词，**新文案统一写「人物详情」** |
| **事件集详情** | 事件集主页点**事件集项** | 不写「集合页」 |
| **事件详情** | 在人物详情 / 事件集详情 / 时间线主页 / 日历主页点**事件项** | 不写「事件页」 |

### 跳转关系

```
人物主页 ──点人物项──▶ 人物详情 ──点事件项──▶ 事件详情
事件集主页 ─点事件集项─▶ 事件集详情 ─点事件项─▶ 事件详情
时间线主页 ─点事件项──────────────────────▶ 事件详情
日历主页 ──点日期框─▶ 当天时间线（仍属时间线主页）；点事件项 ▶ 事件详情
```

### 用词禁令

- 不用「条目」「卡片」「记录」指代事件项；不用「列表页」「首页」指代主页。
- 详情页一律是「X 详情」，不写「X 页」「X 资料页」。
- 四个主页之外，其它页面（设置、功能体验、边缘分割等）不以「主页」称呼。

---

# 第一部分 · 开发流程规范

## 1.1 版本管理

**分支模型：每次改动都开新分支（feature branch per task）**

- **每一次改动都创建新分支**，命名 `feat/<简短名>`、`fix/<简短名>`、`docs/<简短名>`；
- 分支建好立刻 `git push -u origin <分支名>`：分支必须在 GitHub 上可见，只在本地存在等于没建分支（2026-10-23 用户补充）；
- 分支任务完成、构建与自测通过**之后**，才合并回 `main`；
- 合并后立即删除该分支，**本地与远端都删**（`git branch -d` + `git push origin --delete`），`main` 永远保持可发布状态；
- `main` 上不直接提交**任何**改动——包括本文档与 `CLAUDE.md` 的宪法修订，**无例外**；
- 里程碑打 tag：`git tag -a v0.1.0 -m "MVP：三层模型 + 导入导出"`。

理由：多人协作 + AI 辅助，"改完直接进 main"会让 `main` 频繁处于不可用状态；一任务一分支，回滚粒度清晰、冲突面最小。

> 历史沿革：本文档原为 trunk-based（直接在 main 开发），2026-10-23 用户改为"每次改动必须新开分支"，本条已同步更新。

**合并回 main 的硬性规则（与 `CLAUDE.md` 铁律五一致）**

> 用户 2026-10-23 立规：**在不与 main 冲突的前提下合并；一旦冲突，解决自己的分支，main 慎重改动。**

- 合并前先 `git fetch origin --prune`，确认远端真实状态；
- **先在自己分支上合 main**，冲突在自己分支解决；main 侧代码一行不改；
- 只允许 `git merge --ff-only`，禁止在 main 上 rebase / reset / amend / 手改代码；
- 冲突时**以 main 为准**：main 改动优先，自己改名/挪位适配；无法两全则停手报告用户裁决；
- 合并前后各跑一次 `npm run build` + `npm run build:cli`；
- 合并后先推 main，再删功能分支：本地 `git branch -d` + 远端 `git push origin --delete`；远端只剩 `main` 与 `gh-pages`。

**不走 PR，直接合并（2026-10-23 用户确立）**

- 本仓库**不使用 Pull Request 流程**，也不再等待 CI 通过才合并；
- 合并前的前置闸门由**本地**承担：`npm run build` + `npm run build:cli` 必须全绿，自测通过；
- 仓库里**没有任何 CI 兜底**：`ci.yml` 与 `ci/pr-workflow` 分支已于 2026-10-23 一并删除，合并门槛完全由本地构建承担；
- 因此**本地构建就是唯一门禁**，跳过构建直接合并视同违规。

**合并即发布：版本时间必须前进（2026-10-23 用户确立）**

- 版本时间 = `vite.config.ts` 中 `__BUILD_TIME__: new Date().toISOString()` 在构建那一刻取的值；不构建就不会变。
- **线上时间由 CI 产生**：`deploy-pages.yml` 在 push 到 main 后执行 `pnpm build` 并覆盖 `gh-pages`。本机 `npm run build` 只作为合并门禁，它的时间不会出现在线上。
- 合并推送后等该 run 变绿，打开「人物」主页面，标题上方的版本条「壳:… | 网:…」里的「网」应与**这次 Actions 构建**的时间一致（比本地门禁构建晚几十秒属正常）；双击这一行可原地重新加载。
- 时间没前进 = 发布没生效（部署未完成或浏览器仍命中旧 SW），此时不要判断成功能没写对。
- **禁止**手改 `src/core/buildInfo.ts`、禁止把 `BUILD_TIME` 写成常量，那等于伪造版本号。

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
6. **短控件与字段名同行**：`<Field inline>`（`.field-inline` + `.field-control`）用于一行就填得完的
   字段（时间、评分、花费、下拉）。字段名顶端对齐第一行控件（`padding-top: 5px`），控件区
   `flex-wrap` 自己换行——错误提示、坐标回显这类 `flex: 1 0 100%` 的行另起一行，不会把字段名挤到中间。
   标题、正文、标签、参与者这类会长内容的字段保持名在上、控件在下。
7. **图标用内联 SVG，不用 emoji**：emoji 在部分安卓/Linux 上渲染成空心方框，且不跟随主题色。

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
| e2e | 关键流程 | 建人物 → 记事件 → 归集 → 导出 → 导入；AI 审核后执行矩阵（`review-matrix-e2e`）；服务/任务两层体系（`runtime-e2e`） |

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
- 每次 tag 时在 `CHANGELOG.md` 补一条，格式：`## [v1.2.0] - 2026-10-29` + 新增/优化/修复/兼容性列表。
- 本项目自 v1.0.0 起按 `RELEASE.md` 发版：改 `package.json` 的 `version` → 双门禁 → 合 main 触发
  部署 → 打 tag；网页与壳的同号约定、`proto` / `shellMin` 与回滚规则以 `RELEASE.md` 为准。

## 1.7 工具留存与说明

写在前面的一句：**写过的工具不许删**。过去反复出现同一件事——脚本用完就删，下次需要又从头写一遍，浪费的时间比维护它多得多。

**定义**：这里的「工具」指为了开发、验证、部署、排障而写的东西，包括 `scripts/`、`tools/` 下的脚本，`src/core/tools/` 里的 AI/CLI 工具，以及一次性的调试脚本、生成器、截图脚本、数据迁移脚本。

**留存规则**

1. 工具写完后必须写清「怎么用」：用途一句话、入口命令、依赖、注意事项。写在工具同目录的 `README.md`，或在 `tools/README.md` 的索引表里加一行。
2. 工具被取代、暂时用不上，**不删文件**，就地标注 `@deprecated` 或加注释「已被 X 取代，保留原因：…」。
3. 能复用就别重写：动手前先看 `tools/README.md` 和 `scripts/`，确认没有现成实现。
4. 允许删除的只有三类：含密钥/个人隐私的、纯构建产物（`dist/`）、以及放在 `/tmp` 从未入库的临时脚本。
5. 删除任何已入库的工具，必须在提交信息里写明理由，并在 `tools/README.md` 里留一行「已移除：X（原因）」——留下痕迹，别让下一个人再踩一遍。

---

## 1.8 数据库引擎（sql-wasm.wasm）的缓存约定

引擎是**固定二进制**：`public/sql-wasm.wasm`（685KB）来自 sql.js 发布包，不含业务代码也不含用户数据。只要 `package.json` 里的 sql.js 版本不变，它一个字节都不会变——改业务代码不会变、重新部署不会变。所以它必须缓存，缓存了也绝不会「读到旧逻辑」。

**约定（改这几处前先读完本节）**

1. 启动路径：`src/core/db/index.ts` 先查 `src/core/db/wasmCache.ts`，命中就用本地字节初始化（零网络请求，进度条直接进到「启动引擎」）；未命中才带进度下载，下完写进缓存。
2. 缓存桶名 `dr-wasm-v1` 是**固定的**，不跟 SW 的版本缓存一起换。`public/sw.js` 的 `activate` 清理旧缓存时必须跳过它；`install` 只在桶里没有时才 `add`。
3. `index.html` 里那行 WASM preload **只在没缓存时才插入**（内联脚本判断 `caches.has('dr-wasm-v1')`）。写死成静态 `<link rel=preload>` 会让每次打开页面都发一次请求——这正是「每次刷新都在重新下载数据库引擎」的原因。
4. Service Worker 的注册在 `main.tsx`，且必须判断 `document.readyState === 'complete'`：注册发生在引擎加载完之后，此时 `load` 事件早已过去，无条件监听 `load` 等于永远不注册。
5. 校验：缓存读取后检查文件头 `\0asm` 与最小体积，坏缓存自动丢弃重下；拿缓存初始化失败时会清缓存并退回网络取一次。
6. **升级 sql.js 时**：把 `wasmCache.ts` 与 `sw.js` 里的 `dr-wasm-v1` 一起改成 `v2`，旧缓存立即失效。

验证工具：`node tools/e2e/wasm-cache-check.mjs <url>`（先 `npm run build` + `vite preview`）。连续刷新三次，`sql-wasm.wasm` 的网络响应应当只有 1 次。

---

## 1.9 成果（快照）的展示语义

一次 AI 操作流只生成 **1 条成果**（`agent.ts` 里 `resumeSnapshotId` 复用上一轮快照），名字取**用户第一条指令**（比罗列九个工具调用好认）。

**两层界面，各管一件事**：

- **列表卡片**：只显示「标题（用户指令）+ 时间」。不堆净变化数字、不堆对象 chip、不显示来源/体积/操作数——这些和详情重复，只会让卡片变长、扫一眼分不清。
- **详情弹窗**：按「净变化」分组展示具体对象（`LabAiSection` 里的 新增 / 修改 / 删除 三组），每组项可点开真实详情页；删除类点开显示删前存下的内容，不跳详情。

**分组一律按「净变化」，不按工具调用次数**：`core/snapshots/diff.ts` 拿「动手前快照」（`createSnapshot` 是整库 `db.export()` dump）和「当前库」逐表对比（`SELECT *`，三张主表列不齐，写死列名会让查询报错、分组变空），按行内容指纹（排除 `rev`/`updated_at`/`hlc`/`deleted_at`）判断是否变过。修改 / 删除 两组来自「预先存在、这一轮被改 / 被删（软删或归档合并）」的对象，必须能正常出现——这俩分组是成果价值的主体，绝不能空着。

| 情况 | 归入 |
|---|---|
| 快照里没有、现在有 | 新增 |
| 快照里有、现在内容变了 | 修改 |
| 软删（`deleted_at`）、人物归档 / 被合并 | 删除 |
| 建了又删（快照里没有、现在也没有） | 净变化为零，只在详情里注明一句 |

拒绝单条改动走**仓库层的软删**（`deletePerson` / `deleteEvent` / `deleteCollection`），不要直接 `DELETE`——会绕过 oplog 与回收站，用户反悔找不回来。

验证：`node tools/e2e/fake-ai-flow.mjs` + `node tools/e2e/snap-flow-e2e.mjs`（配一个指向假服务的模型即可，不需要真密钥）。

---

## 1.10 成果详情 ↔ 对象详情页的往返（来路记忆）

成果详情是弹窗，里面点「P1 / E1 / Es1」会切到真实详情页，弹窗所在的设置页随之卸载。跳过去容易，**回来难**——以前只能重走 设置 → AI → AI 对话 → 成果 → 点开，多数人走到一半就放弃了。

约定：`src/ui/snapReturn.ts` 存一个**内存态**的 pending snapId（刷新即失效，不必持久化），三段接力：

| 环节 | 位置 | 做什么 |
|---|---|---|
| 记 | `LabAiSection` 的 `DiffChip` / `SnapTargetChips` | 跳转前 `setSnapReturn(snapId)`；删除类只弹「删前内容」小窗，不离开本页，不记 |
| 回 | `App.backToList` | 有 pending 时返回键进设置页，而不是丢回列表 |
| 落 | `Settings` 初始 sub / `LabAiSection` 挂载 | 前者有 pending 时直落 `labAi`；后者 `takeSnapReturn()` 切到「成果」并重开那份详情 |

**清掉的时机**：用户自己关掉成果详情、点了「接受」或「放弃」，`clearSnapReturn()` 结束回程。注意要放在 `window.confirm` **之后**——否则用户点取消也会把来路清掉，再看一眼对象就回不来了。

事件走的是「时间线 + 弹窗」，没有返回键，靠点底部「设置」回；人物/事件集走详情页，按返回键回。两条路都必须能回到原成果。

另：`Timeline` 以前在**渲染期间**直接调父组件的 `onOpened`（App 的 `setJumpEventId(null)`），触发 React 的「渲染 A 时改 B」警告。这类"通知父层"的回调一律放 `useEffect`，渲染期间只改自己的 state。

---

## 1.11 AI「审核后执行」约定（数据安全硬要求）

AI 执行操作**不能让用户直接承受后果**——它跑完一整轮后，改动先"挂起"，用户**审阅并点「执行」**才真正落到真实库；不想要就「放弃」，真实库原样不动。这是用户对数据安全的硬要求（"不小心删错了也没办法了"）。

**机制（回滚式，核心在 `src/core/snapshots/index.ts`）**：整库两份字节——`before` 就是动手前拍的快照，`after` 是 AI 跑完导出的另一份，存在后端 store 里。

| 环节 | 函数 | 做什么 |
|---|---|---|
| 动手前留底 | `createSnapshot('ai', …)` | 整库 export 存字节 + 元数据；轮次中算出净变化回写 `diff` |
| 回合结束暂存 | `stageAiTurn(id, ops, note)` | 导出 after → **立刻把库实例切回 before**（真实库回到动手前）→ after 存 `afterId`，状态置 `review:'pending'` |
| 用户点「执行」 | `applyPendingSnapshot(id)` | 把 after 换回当前库实例，删 afterId，状态置 `applied` |
| 用户点「放弃」 | `discardPendingSnapshot(id)` | 库本来就没变，删 before/after 字节和这条成果即可 |
| 待执行时改名 | `renamePendingRecord(snapId, kind, id, name)` | 只改 after 字节里那一条记录的名字，不碰真实库 |

**为什么是"整库两份字节"而不是别的**：AI 一轮可能触发十几次写，用户不可能连点十几次撤销；且中途任何刷新都会清空内存撤销栈。快照落盘（`store.put` + `flushPersist`）才能管住"整体不对，想回动手前"。`after` 也落盘，所以**刷新页面 pending 不丢**，回来还能执行/放弃。

**与「撤销栈」的分工**：撤销栈在内存、刷新即失效，管"刚才那一下点错了"；快照落盘，管"AI 一顿操作之后整体不对"。两者不替代。

**换库 = 撤销历史清零（硬规则）**：撤销栈是"整库快照式"——每一步存的是**旧库实例**的字节。凡是把库实例整个换掉的地方（`stageAiTurn` / `applyPendingSnapshot` / `discardPendingSnapshot` / `restoreSnapshot` / `revertAiTurn`），换完必须 `resetUndo()`（`src/core/db/undo.ts`）。不清栈的后果：pending 时按撤销会把**没落地的 AI 改动一步步放回真实库**；执行后按撤销会把**刚进库的成果撤掉**。同理，放弃（discard）后不清栈，撤销也会把放弃掉的改动放回来。

**同批踩过的坑（改这几个函数前必读）**：
- `prune()` 扔最旧快照时必须**让 `review==='pending'` 的优先保留**——before 字节一被淘汰，这份成果就再也无法执行/放弃，`afterId` 还会变成孤儿字节。保留后要按原顺序（新的在前）写回 meta。
- `restoreSnapshot()` 换库后必须把**当前 meta 列表带着写进新实例**：快照字节是"恢复目标时刻"导出的，那里面既没有 auto 留底、也没有之后新建的快照；不带着换，成果列表会直接清空退回目标时刻的旧样子（`writeMeta` 要在 `setDbInstance` 之后调）。
- `agent.ts` 回合结束回写 diff 时，**`reverted` 也要存**：建了又删的轮次三组都为空，不存 diff 的话成果详情里什么都不显示，用户看不出这一轮动过什么（详情里的"动过又复原"提示条依赖它）。
- **同一时刻最多一份 pending**：两份 pending 基于同一个 before，先后执行会互相覆盖丢数据。`LabAiSection` 的 `send()` 用 `hasPendingSnapshot()` 拦截，没处理完不让发下一轮。
- **执行前必须校验"库还是暂存时的样子"**（`applyPendingSnapshot` 返回 `'ok' | 'stale' | 'gone'`）：pending 挂着的时候用户照样能改数据（手动改记录 / 合并导入 / 同步合并），after 是旧世界的整体快照，照旧换进来会把暂存期间的新改动**连锅端掉**，且换库时撤销栈已清零，用户连撤销都救不回来。校验用 `dataFingerprint()`（除 `meta` 与 `sqlite_%` 外全表按 rowid 序列化后比对，before 字节开只读副本对照）——排除 `meta` 是必须的：快照元数据、AI 会话、hlc 计数器都写在那，暂存本身就会改它，不排除每次执行都误报。命中 stale 时 UI 拦住并提示先放弃这轮让 AI 重做。回归场景：矩阵 e2e S12。

**输入与轮次约定**（在 UI / agent 层）：
- 对话框 `Enter` **只换行**，`Cmd/Ctrl+Enter` 才发送——换行不能误触发送（见 `LabAiSection.tsx` 的 `onKeyDown`）。
- `runAgentTurn` 的 `maxRounds` **不硬性封顶**：`const maxRounds = opts.maxRounds; if (maxRounds && rounds > maxRounds)`——没传就一路跑到模型主动收尾，不限制 AI 的思考轮次。

## 1.12 「服务 / 任务」两层体系（后台运行时）

一次性的后台工作叫**任务**（AI 正在回复你）；常驻后台的东西叫**服务**（背景音乐）。两者的状态都放在模块级单例里，UI 只是订阅式视图——**组件卸载不影响单例继续跑**，这是"离开聊天页 AI 不中断"的根本原因。

| 文件 | 职责 |
|---|---|
| `src/core/runtime/store.ts` | 任务/服务的响应式数据中心（pub/sub，仿 `toast` 模式）：`useTasks/useServices` + `addTask/finishTask/markTaskRead/updateTask/removeTask` + `registerService/setServiceRunning/setServiceAutostart/setServiceDetail`。只存状态，不碰 UI。**自启动存档**也归这里：`dr.svc.autostart` 一张表记所有开了自启动的服务，`registerService(s, start?)` 接收服务交出的启动函数，`restoreAutostartServices()` 在应用加载完毕后统一点名恢复 |
| `src/core/runtime/aiChat.ts` | AI 聊天全局单例：轮次执行态（busy/activity/items/history/session）原来在 `LabAiSection` 的 state 里，离开即卸载丢失；现在 `sendTurn` 由单例驱动，页面只订阅。发送即 `addTask({kind:'ai-chat'})`，成功 `stageAiTurn` 后 `finishTask(true)`，失败 `revertAiTurn` 后 `finishTask(false)` |
| `src/core/runtime/music.ts` | 背景音乐服务单例：`<audio>` 用 `document.createElement` 全局托管（原来在 `MusicPanel` 里，离开即停）；`registerService(..., startService)` 交出启动函数，自启动存 store 统一存档（旧 key `music-autostart` 首次开机自动搬迁并清除）；**服务运行态由 audio 的 play/pause 事件驱动**——播放/暂停/切歌/自动下一首全经过事件，head 图标不会和实际声音脱节。歌单（`.drpl`）选中后是队列的持久化真相：增删/排序防抖 350ms 写回文件，`pagehide` / `visibilitychange:hidden` 时强制落盘；没选歌单则退回旧的 localStorage 临时队列 |
| `src/core/runtime/locationAuto.ts` | 定位「自动打点」服务单例：按打点策略取 GPS、按写策略写回 `.drloc`。定时器与写入串行链在单例里——离开定位面板照打（服务语义）；面板 `LocationPanel` 只是订阅式视图 + 地图渲染，显示坐标统一走 `applyOffset(原始点, 文件 offset)`。**服务分五层**：① `acquireFix()` 取坐标（失败就抛）→ ② `writeFixWithPolicy()` 带策略写文件（阈值从浏览器 `dr.autoLocation` 现读、文件认当前激活的，去重/顶替在这一层，调用方无脑调）→ ③ `sampleOnce()` 按策略采样并交给 ② → ④ `runAutoService()` 从内存读注册信息把服务跑起来 → ⑤ `initLocationAutoService()` 从浏览器读自启动注册与参数写进内存、唤醒 ④。手动打点只调 ①+②，定位失败就丢弃 + 面板弹窗，不写半个点。**支持自启动**：`registerAutoService` 交出 `startAutoService` 启动函数，`restoreAutostartServices()` 统一恢复；`fileReady` 标志保证「文件内容读完才起服务」，避免先写空把旧点覆盖掉；注册时按真实运行态登记，不谎报「运行中」。没选文件时自启动拉不起来（留「未选择打点文件，暂无法自启动」说明）。**原生看门狗**两条判据：壳 `status.tracking !== true` 连续 3 次，或 `tracking===true` 但 25s 一个点都没到（壳「假跑」：前台服务一启动就置 `isRunning`，定位源却没给它点），任一成立就 `yieldToPageTimer()` 退回页面定时器——只让出记录权、不断开事件订阅，壳回魂了点照样合并 |
| `src/core/runtime/nav.ts` | 全局导航（`setNavHandler`/`navigate`，仿 `setEventOpener` 一族）：App 注册实现，head 图标/服务页借此跨页跳到指定设置子页 |
| `src/ui/runtime/HeadStatus.tsx` | head 右侧状态区：活动/未读任务图标（运行中蓝色脉冲、完成绿、失败红，带未读角标）、运行中服务图标（悬停显示 `标题 · 当前活动 · 待办`）、「服务」「任务」入口。挂在主页 head、时间线/日历 `PageHead` 与设置页 `PageHead` 的 right 槽 |

**任务语义**：`addTask` 同 kind 顶掉旧的 finished 记录；`finishTask` 完成即置 `unread:true`（即便之前在聊天页清过未读——完成本身是新的通知）；点图标/点开来源页 `markTaskRead` 清未读，**进行中的只跳不清**；任务页可手动 `removeTask`。

**服务语义**：`registerService(s, start?)` 幂等；自启动以存档 `dr.svc.autostart` 为准（注册时覆盖调用方传入值，checkbox 才和"刷新后会不会自启"一致），`setServiceAutostart` 写存档 + 翻 store；被浏览器自动播放策略拦住时 note 置「待播放：点一下恢复」，running 仍为 true（服务在，等一个手势）。开机顺序：App 一个 effect 里先 `initMusicService()` + `initLocationAutoService()` 完成注册，再 `restoreAutostartServices()` 统一恢复——新服务要自启动，只管注册时交启动函数，不自己碰存档。

**踩过的坑**：① `setAutostart` 最初只改 localStorage 和 running，没同步 store 的 `autostart`——受控 checkbox 每次重渲染都被打回原值，表现为"点了开关没反应"。凡是单例状态被 UI 受控渲染的，写入口必须同时更新 store。② 服务运行态最初只在 `startService` 里置，用户在面板点播放走的是 `toggle → a.play()` 另一条路——head 图标不出现、服务页显示"已停止"但歌在放。改成由 audio 的 play/pause 事件驱动后才根治（事件覆盖所有播放路径，包括切歌和自动下一首的瞬时空档）。

**回归**：`node tools/e2e/runtime-e2e.mjs`（R1–R9：离开页面不中断、变色、点跳清通知/进行中不清、入口页、自启动、默认关闭、任务页清除、失败变红、播放/暂停驱动服务图标）；定位打点服务另有 `node tools/e2e/location-service-e2e.mjs`（L1–L5）；定位文件格式与分段页有 `node tools/e2e/location-format-tabs-e2e.mjs`（D1–D9）；自启动存档迁移（旧 `music-autostart` key 的老用户）有 `node tools/e2e/music-migrate-e2e.mjs`（M1–M3）。

**顺带修的预存 bug**：`7dc62fb` 抽歌单持久化时丢了"空歌单则收养所有音频"的逻辑——"从本地添加"上传后文件进了文件库但歌单显示 0 首。现在 `getPlaylist()` 在 key 从未存在过时播种为全部音频（落库一次，之后用户删空就是真的空）；`useUploader.upload()` 返回本次落库的文件，MusicPanel 上传后直接 `addTracks`，两种路径都兜住。

### 1.12a 歌单：文件库里的 `.drpl`

**定位**：歌单不做独立表，就是文件库里一条普通附件。这样备份 / 坚果云同步 / 分享 / 隐私 / 类型筛选 / 预览全部自动覆盖，后续功能（事件正文引用、数据分析选歌、AI 操作）只需要认 `file.id`，不必另接一套存储。

**格式**（`core/music/format.ts`）：扩展名 `.drpl`，MIME `application/x-dr-playlist`，正文是 JSON：

```json
{ "format": "dr.playlist", "version": 1, "name": "夜跑", "description": "",
  "createdAt": "…", "updatedAt": "…",
  "tracks": [{ "id": "f_…", "storedId": "sha-…", "name": "a.mp3", "mime": "audio/mpeg", "size": 123 }] }
```

曲目同时记本机附件 `id`、内容寻址 `storedId` 和名称快照。解析按 **id → storedId → 唯一文件名** 依次兜底，换设备 / 重新导入后仍能对上；对不上的条目进 `missing` 计数并显示，编辑时不会把缺失条目静默丢掉。写入时 `name` 以文件名去 `.drpl` 为准（改名同时改文件名），`updatedAt` 自动刷新。

**代码分工**：

| 文件 | 职责 |
|---|---|
| `core/music/format.ts` | 纯格式层：判定、解析/序列化、名称清洗、`resolvePlaylistTracks` |
| `core/music/playlistFile.ts` | 文件库 CRUD：`listPlaylists/createPlaylist/readPlaylist/writePlaylist/updatePlaylistMeta/deletePlaylist/importPlaylistText`；选中态存 localStorage `dr.music.active-playlist` |
| `core/runtime/music.ts` | 队列真相：选中歌单后增删/排序防抖写回；`saveChain` 串行 + `saveRev` 版本号 + `dirty` 门，防止旧快照后落盖掉新内容；`pagehide` / `visibilitychange:hidden` 强制 flush；`openPlaylist/detachPlaylist/saveQueueAsPlaylist/renameActivePlaylist/deleteActivePlaylist` |
| `ui/panel/MusicPanel.tsx` | 歌单条：下拉切换、新建（可带上当前队列）、导入、改名/改描述、删除、保存状态与缺失提示 |
| `ui/preview/PlaylistPreview.tsx` | 文件库点开 `.drpl` 的预览：曲目表 + 缺失项 + 一键播放 |
| `core/tools/playlists.ts` | `playlist.*` 六个工具，CLI / AI 与 UI 共用实现 |
| `ui/files/*` + `ui/preview/kind.ts` | 新增「歌单」筛选类型；`FilesSection compact` 给音乐面板提供只列音频的紧凑选择器 |

**运行时规则**：没选歌单时仍用旧的 localStorage 队列（UI 显示「临时队列（未保存）」），删除当前歌单或歌单文件被外部删掉时，曲目保留为临时队列，不连坐删除音频；开机按 `active-playlist` 异步恢复，恢复失败自动退回临时队列。`writePlaylist` 走 `overwriteFileContent`，后者现在会同步重算 `sha256`（`stored_id` 不变，旧引用不受影响）。

**回归**：`node tools/e2e/music-playlist-e2e.mjs [url]`（P1–P7：上传+新建、文件库筛选/预览、刷新恢复、改名改描述、增删排序写回、导入 `.drpl`、删除后回临时队列）。

### 1.12b 定位：文件库里的 `.drloc`

**定位**：定位记录和歌单一样，不做独立表，就是文件库里一条普通附件。旧版把点写成 `.csv`，和人手建的表格混在一起、文件页筛不出来；现在换成独一份的 `.drloc`（JSON），备份 / 同步 / 分享 / 隐私 / 类型筛选 / 预览全部复用文件库。

**格式**（`core/location/format.ts`）：扩展名 `.drloc`，MIME `application/x-dr-location`，正文是 JSON：

```json
{ "format": "dr.location", "version": 1, "name": "夜跑",
  "offset": { "lat": 0.000123, "lng": -0.000456 },
  "points": [{ "ts": "…", "lat": 31.2304, "lng": 121.4737, "accuracy": 5, "note": "" }],
  "createdAt": "…", "updatedAt": "…" }
```

`points` 永远是**原始坐标**；`offset` 是这个文件相对底图的整体修正量（单位：度，正值向北 / 向东）。显示、列表、地图、预览统一走 `applyOffset(points, offset)`，所以改偏移只是整体平移，不改写任何一条点。

**面板三种修正方式**：文件里只存度，界面提供三种填法，结果都只是改 `offset`：

| 方式 | 填什么 | 换算 |
|---|---|---|
| 度数 | `Δlat` / `Δlng`（度） | 原样写入 |
| 距离 | 南北 / 东西多少米 | `Δlat = north / 111320`，`Δlng = east / (111320 × cos(参考纬度))`，参考纬度取点的平均纬度 |
| 目标 | 第 1 个点应该落在的经纬度 | `offset = 目标 − 第 1 个点原始坐标`；两项都留空 = 不偏移（归零） |

目标方式锚定**第 1 个点**而不是平均值：平均纬度会随补点漂移，起点不会。没有点时三种方式一起禁用（算不出参考纬度 / 没有锚点），先打点再修正。CLI / AI 的 `location.create` / `location.save` 同样三选一：`offset`（度）/ `offsetMeters: { north, east }`（米）/ `target: { lat, lng }`，同时给多个会报错；`location.get` 回传 `offset`、`offsetMeters`、`refLat`、`anchor`（第 1 个原始点）和 `target`（它修正后的坐标），三种表示可互相换算。

**代码分工**：

| 文件 | 职责 |
|---|---|
| `core/location/format.ts` | 纯格式层：判定、解析/序列化、名称清洗、`applyOffset`、米/度换算（`refLatOf` / `offsetFromMeters` / `metersFromOffset`）、旧 CSV 解析 |
| `core/location/locationFile.ts` | 文件库 CRUD：`listLocations/createLocation/readLocation/writeLocation/importLocationText/deleteLocation`；选中态存 localStorage `dr.locationFileId` |
| `core/runtime/locationAuto.ts` | 自动打点服务单例：原始点、offset、当前 GPS 蓝点、`rev` 结构版本都在这里；`saveChain` 串行落盘，偏移编辑与自动打点不会互相覆盖；手动 `punch` 返回新点下标，`removePoint` 按序删点 |
| `ui/panel/LocationPanel.tsx` | 四个分段（地图 / 记录 / 文件 / 说明），沿用 AI 对话页的 `.aichat-tabs`；文件页内嵌只列定位文件的 `FilesPanel compact`，位置修正支持度数 / 距离 / 目标三种填法；记录页逐点删除，一次只渲染最近 300 条 |
| `ui/preview/LocationPreview.tsx` | 文件库 `.drloc` 只读预览：可滚动点位表（100 点分页）、上一点/下一点/滑块跳转、「播放点位 / 暂停播放」逐点动画（200ms 一步，末点自动停，拖滑块即暂停）、偏移后的 Leaflet 速度彩虹地图；原始文件不改写。回归 `tools/e2e/location-preview-e2e.mjs`，数据仍由 `location.get` 向 AI/CLI 提供 |
| `core/tools/locations.ts` | `location.*` 八个工具（list/get/create/save/add/remove/import/delete），CLI / AI 与 UI 共用实现 |

**地图约定（速度着色）**：线宽 4px，颜色不再是一个常量——每段采用两段窗口速度（`segmentSpeeds()`：BC = (haversine AB + haversine BC) ÷ (tC − tA)，首段仍用单段距离 ÷ 时间差；窗口内任一相邻时间不前进或无效给 `null`，原始点不变；回归 `tools/e2e/location-speed-smooth-e2e.mjs`），按 0 到当前轨迹有效最高速度等分六档（另加「速度未知」档），最高速度对应红色，不再固定 25 km/h 上限；全静止用蓝色，无有效速度显示「未知」。地图图例显示当前速度（默认最新段，回放时为游标所在段）及全轨迹最高速度，回放不改变色阶上限；档位颜色固定为**蓝 → 青 → 绿 → 黄 → 橙 → 红**（慢 → 快），不随主题改变，图例与轨迹共用 `speedColors()`；「速度未知」用灰色，免得把「不知道」画成「站着不动」。点的规矩：**最新那个点直径 = 线宽 4px**（白芯 + 深色描边，和主题色色阶明显区分），**历史点直径 = 线宽一半 2px**（淡墨色，只交代采样位置）；选中点放大到 8px 染红。当前位置仍是蓝点，只来自本次定位，不写进文件，只有打点才追加。

**为什么点不用主题色**：线本身就是主题色的浅→深阶，点再用主题色会直接糊在线上。所以给点留了一个固定组合——白芯 + 深边，任何一档底色上都跳得出来；历史点用低透明度的墨色，是「纹理」而不是「珠子」。

**性能（为什么能按速度逐段上色）**：上千个点逐段一条 polyline 会拖死渲染。`speedLines()` 把「同档位且首尾相接」的段合并成多段折线，最终**最多 7 条 polyline**；地图整体开 `preferCanvas` 走 canvas 渲染（`L.canvas({ tolerance: 8 })`，小点也点得中，点击命中靠 canvas 的 `_containsPoint`）。点位改用 `L.circleMarker` 而不是 DivIcon：2000 个点的文件从导入到出图约 0.36s，拖动平移不掉帧（实测约 330ms / 20 步）。渲染结果（点数、点径、历史点径、最新点、选中、连线颜色）挂在 `.loc-map` 的 `data-loc-*` 上，canvas 里查不到 DOM，e2e 就靠这几个属性断言。

**大量点时**：自动打点每秒都会刷新「当前 GPS」，但只有**点结构变化**（新增 / 删除 / 换文件 / 改偏移）才重建地图图层——`rev` 只在真正落点时才 +1（原地去重会顶掉末点连坐标一起换，所以也算结构变化）；选中点只改样式（canvas 上用 `bringToFront`，没有 zIndexOffset），蓝点仍是单独一个 DOM marker。记录列表切片渲染最近 300 条，可「显示更早」。原地不动时落盘最多 15 秒一次（新增点仍立即写）。几万点的文件仍会在**首次建图层**和**整篇 JSON 重写**上变慢，建议按行程分文件存。

**回放**：在**地图页现有布局里**加一块 `.loc-play` 卡片（≥2 个点才出现），不新开路由。两个维度：单位（按时间 / 按点）× 顺序（顺序 / 逆序）。游标是「单位空间」里的一个数——时间模式是毫秒，点模式是浮点下标；两种模式共用同一套推进逻辑，切单位时把游标换算过去，位置不回跳。实时推进由一条 rAF 循环完成（`dt` 上限 0.25s，防止切后台回来一次跳太远），速度是「每秒推进多少秒记录 / 多少个点」，步进是「每步多少秒 / 多少个点」；到两端夹住并自动停（按钮回到「播放」）。时间模式落在两个点之间的空档时停在**上一个点**上（标题继续显示该点时间），这样长空档不会看起来像卡死；点模式就是逐点走。地图上已走过的部分用紫色（`COLOR_PLAY`）加宽到 `LINE_WEIGHT × 2.5`、透明度 0.7 盖在原轨迹上，原轨迹同时降到 0.3；播到视野外才 `panTo`（不做每帧跟随）。重绘按点下标变化 + 70ms 节流，几万点也不会每帧重建图层。离开地图分段或换文件即停。默认值：60 秒/秒、2 点/秒、10 秒每步、1 点每步。

**运行时规则**：自动打点是后台服务，离开面板仍按阈值记录；恢复上次文件失败（被删 / 内容损坏）时回到未选择状态，不拿空队列覆盖文件。旧 CSV 不原地改写，导入时统一转成新的 `.drloc`。

**回归**：`node tools/e2e/location-format-tabs-e2e.mjs [url]`（D1–D9 + D5b–D5e：分段切换、新建、空文件不能米制换算、导入带偏移的 `.drloc`、地图渲染（速度线取主题色深浅、打点直径 = 线宽、历史点直径 = 线宽一半、蓝点、选中追踪）、按米改偏移写回且原始点不变、度数 / 目标两种填法及目标留空归零、文件库筛选/预览、旧 CSV 转换、逐点删除、300 条分页）；回放见 `location-playback-e2e.mjs`（P1–P6：卡片出现条件与默认值、按点播放/停止、步进与越界夹取、逆序、按时间到末尾自动停、切换单位保留位置）；后台服务语义见 `location-service-e2e.mjs`（L1–L5）。

### 1.13 取色面板：彩虹 + 历史 + HEX / RGB

凡是「要挑颜色」的地方都用同一个面板（`ui/color/ColorPicker.tsx`）：

| 入口 | 用法 |
|---|---|
| 事件集 / 人物图标的前景、背景 | 预设色块后面的「＋」展开面板，弹窗内嵌（`compact`），背景允许选「透明」 |
| 自定义属性（类型 = 颜色） | 色块按钮点开面板，展开在字段下方 |
| 设置 → 外观 → 自定义颜色 | 按钮展开面板，主题色立即生效 |

**布局与交互**：左边是彩虹渐变（横向色相、纵向白→纯色→黑，`hsl(h, 100, l)`），拖动即取色；右边一列是**全局历史颜色**（最多 16 个，最近用的排最前）；下面一行是 HEX 与 RGB 输入，外加当前色预览块。历史的存储键是 `dr.recentColors`（localStorage，只存本机、不进备份），`ui/color/history.ts` 用模块级缓存 + 订阅让同页多个面板同步。

**数值约定**：落库统一小写 `#rrggbb`（`normalizeHex` 兼容 `#rgb` / `#rrggbb` / `rgb(r,g,b)` / 三个裸数字）；HEX 只在凑齐 6 位时提交，3 位简写在失焦时展开；RGB 三个框组内切换不提交，焦点离开整组才提交——主题色会把过浅的颜色压暗，逐位提交会让后一位基于被压暗的值计算，数值自己跑掉。主题面板传 `live={false}`，拖动时只本地预览、松手才应用，避免「自动加深」和手指打架。

**代码分工**：`ui/color/color.ts`（解析 / HEX↔RGB↔HSL）、`ui/color/history.ts`（历史存取 + hook）、`ui/color/ColorPicker.tsx`（面板）、`styles/color.css`（样式）。

**回归**：`node tools/e2e/color-picker-e2e.mjs [url]`（C1–C6：彩虹在左历史在右、HEX 应用、RGB 应用、彩虹拖动、历史刷新保留、图标自定义色保存生效并进入历史）。

### 1.14 软件适配测试：安卓壳自检（设置 → 功能体验 → 软件适配测试）

来源是安卓壳项目 `geckoview_example` 的 `assets/test.html`：一个纯 HTML 页，用 `window.postMessage` 调原生桥。那个壳现在已经从 GeckoView 切到系统 WebView：网页侧要的权限回调从 `GeckoSession.PermissionDelegate.onMediaPermissionRequest` 换成 `WebChromeClient.onPermissionRequest`，桥协议没变（`gv-bridge-*`），所以这一页不用跟着改。这一页把同样的检查项搬进应用，换成本项目的卡片样式，另加一张「本软件依赖」——适配一个新壳时，先看 WebAssembly / IndexedDB 在不在，比逐项点原生能力更快定位问题。

> **2026-10-26：删掉了「判断是不是在壳里」的整套东西**——`core/compat/pairing.ts`
> （版本 / proto 配对、配对状态）、`<html data-gv-bridge-*>` 注入标记读取、
> 「版本配对」卡、版本条里的「壳:…」那半。理由：网页在壳里和在浏览器里行为应当一致，
> 不该拿「在不在壳里」去做任何分支判断；而注入标记又答不了「这个壳有没有某个能力」。
> 现在的规矩只有一条：**想知道某个能力在不在，就发一次 action 看有没有人回**。
> 桥的收发（`invoke` / `onBridgeEvent` / `ping`）、返回键事件、文件 / 录屏 / 蓝牙都不受影响。

| 卡 | 走哪条路 | 检查什么 |
|---|---|---|
| 引擎信息 | 标准 | UA、SecureContext、Gecko 判定、Android、显示模式 |
| 原生桥状态 | postMessage | 只 ping 一次（3s 超时）；不再读 `<html data-gv-bridge-*>` 注入标记（2026-10-26 删除） |
| 应用依赖 | 标准 | WebAssembly / IndexedDB / Blob 下载 / Service Worker / PointerEvent / 存储配额 / 屏幕 |
| 麦克风 | 标准 API | `getUserMedia`，三档约束依次试（默认 → 原始音频 → 指定 deviceId）+ 音量条；失败时列出每档结果与「怎么办」 |
| 定位 | 标准 API | `geolocation.getCurrentPosition`（不开高精度，10s 超时） |
| 蓝牙 · 中心设备 | 桥 | `ble.status / startScan / stopScan / connect / read / write / subscribe / disconnect`，设备与 GATT 来自事件 |
| 蓝牙 · 外设 | 桥 | `ble.peripheral.start / stop / setValue`，连接、写入、订阅走事件 |
| 文件 · 私有 | 桥 | `file.writePrivate / appendPrivate / readPrivate / listPrivate / deletePrivate` |
| 文件 · 公共 | 桥 | `file.writePublic / readPublic / deletePublic`（读取与删除只认最后写入的 uri） |
| 录屏 | 桥 | `screen.start / stop / status / thumbnail` |

**协议**（与壳里那份 `test.html` 一字不差，改一边必须同步另一边）：

- 请求 `window.postMessage({ type: 'gv-bridge-request', id, action, params }, '*')`
- 响应 `{ type: 'gv-bridge-response', id, ok, result | error }`
- 事件 `{ type: 'gv-bridge-event', event, data }`（`ble.deviceFound` / `ble.services` / `ble.characteristicChanged` / `screen.recordingStopped` …）
- 文本走 UTF-8 → base64（`toBase64` / `fromBase64`）；`btoa` 只吃 Latin-1，中文必须自己编码
- 桥根本不存在时 15s 的默认超时太浪费，ping 单独用 3s

**状态与汇总**：每张卡测完向 `ui/compat/report.ts` 报到（模块级 Map），顶部汇总只给「通过 / 失败 / 未测」计数与逐项 ✓✗，不打分——「麦克风被拒」和「桥没人接话」不是一类问题，混成一个分数会误导。状态活在模块里，离开页面再回来还在（蓝牙授权、录屏授权都要过系统弹窗，重来一遍很烦）。

**判定口径**：普通浏览器里桥显示「未连接 / 超时」是正常的，标准 API 那几张卡照样能测；应用依赖只把 WebAssembly / IndexedDB / Blob 三条算进汇总（缺一样就开不了库、存不住、导不出），Service Worker / PointerEvent 缺了不影响能不能用。

**麦克风为什么单独一套逻辑**：`NotReadableError · Could not start audio source` 在 Android 上几乎都不是页面代码的问题——AudioRecord 根本没起来。排查顺序按可能性从高到低：麦克风被别的应用占着 → 系统麦克风 / 隐私开关关掉 → 壳的录音权限（`RECORD_AUDIO` + `WebChromeClient.onPermissionRequest`；旧 GeckoView 壳是 `PermissionDelegate.onMediaPermissionRequest`。当前壳已用录音 / 录屏验证过，所以这一条基本可以先排除）→ 默认约束跟这台设备对不上。所以 `ui/compat/mic.ts` 按「默认 → 原始音频（关回声消除 / 降噪 / 自动增益）→ 指定某个 audioinput 的 deviceId」依次试，权限类错误（`NotAllowedError` / `SecurityError`）立即收手不再弹窗；每档之间留 250ms 让上一档松手；每次请求前先停掉自己上一次握着的流（同一页面重复申请在部分机型上也直接报 `NotReadableError`）。失败时页面列出：`enumerateDevices()` 里 audioinput 的数量与名字、Permissions API 的 microphone 状态、每档的错误名与原文，以及对最后一条错误的「怎么办」。

在此基础上还有三条安卓壳上的实战修正（2026-10-25）：

1. **权限被拒单独一路**：`navigator.permissions.query` 报 `denied` 时连 `getUserMedia` 都不调——安卓壳 / WebView 对拒绝过的来源会一直记住、不再弹框，反复重点只是反复失败。页面直接给「怎么恢复」（设置 → 应用 → 权限 → 麦克风 / 浏览器站点设置），汇总记 ✗。
2. **授权后才重新枚举设备**：WebView 在 `RECORD_AUDIO` 授予前返回的 audioinput 是空 label、甚至空 deviceId，「指定设备」档拿授权前的清单去 `exact` 只会换来 `OverconstrainedError`。第一档失败后重新枚举一次，真名才拿得到。
3. **占用释放等待 + 音量条激活**：`NotReadableError` 常是麦克风被别的应用占着，补一次 1.5s 后的默认档重试；音量条这边，安卓 WebView 默认「媒体播放需要用户手势」，探测链上的 `await` 会断掉手势上下文，`AudioContext` 停在 `suspended`、频谱恒 0（页面显示「已授权」但条不动，最像「录音坏了」）。所以创建后主动 `resume()`，仍不醒就挂一次性 `pointerdown`，用户点一下页面即激活。

**壳侧前提**：注入由壳负责，网页侧看不到壳的代理配置。壳若只对自己的 `test.html` 注入，把本应用加载进去时「原生桥状态」会显示未连接（ping 没人回）——这时要在壳里把注入脚本改成对所有 URL / 所有 frame 生效，网页侧不用改（协议已经对齐）。

**同时下线**：功能面板里的「高精度定位」（高德官方 demo 诊断页）已删除，`panelPrecise` 路由、图标与组件一并移除——定位诊断由这一页的「定位」卡承担，它不依赖高德 key。

**回归**：`node tools/e2e/compat-test-e2e.mjs [url]`（K1–K11）。K1–K6 在真浏览器里跑：入口与 10 张卡、引擎信息、应用依赖、桥没人接话判 ✗、离开再回来仍记得、功能面板不含高精度定位；K7 用 `addInitScript` 装一个假壳，验证「请求 → 响应 → 事件（扫描出设备、连接后出 GATT）」整条链路；K8 是无音频设备时的麦克风失败路径（每档结果 + 设备/权限 + 怎么办 + 汇总 ✗）；K9 用 `--use-fake-device-for-media-stream` 起另一个浏览器验证成功路径（授权成功、音量条出现、汇总 ✓）；K10 mock Permissions API 报 denied，验证不调 getUserMedia、给「怎么恢复」指引、汇总 ✗；K11 断言授权后 AudioContext 是 running（防 suspended 让音量条恒 0 的回归）。

### 1.14b 轨迹提取：截图 → 点 → 轨迹 → 地图复现 → 存成定位文件

入口在「设置 → 功能体验 → 轨迹提取」，只服务一件事：把两步路等 App 的行程截图变成能用的定位数据。页面顶部是一条**五步流程条**（`.lab-track-steps`）：`1 导入图片 → 2 自动取点 → 3 修点 → 4 画路径 → 5 地图对齐`，每步可点，当前步高亮（`on`）、走过的步打勾（`done`）。下面的工作区仍拆成两个页签：**图片 · 画路径**（2 自动取点 / 3 修点 / 4 画路径，全部叠在同一张画布上）和**地图 · 复现与保存**（5 地图对齐）。选完图片就**自动跑一次提取点**，不用再点按钮，所以流程是线性的：图进来 → 点出来 → 修点 → 画线 → 落图。两个页签始终挂载，地图只是用 `display:none` 收起来，切回来不用重建 Leaflet。页头那行状态条是所有步骤共用的反馈位：哪一步出了什么结果、错在哪，都在同一处说。

布局上，图片页从上到下是：状态条 → **五步流程条** → 页签 → 文件名/尺寸 → **画布舞台**（`.lab-track-stage`：滚动画布 + 缩放条 + 擦除画笔）→ **模式条**（`修点` 组：画点 / 擦除点 / 补直线；`画路径` 组：手动布线；外加撤销 + 提示 + 手动统计）→ **动作行**（提取点 / 自动画路径 / AI 优化 / 自动校准 / 换图）→ 点数与簇图例 → **抽屉**（参数与校准 / 图层与偏差）。抽屉默认收起，先把画布让给手指；`.lab-track-stage` 从空状态起就留在 DOM 里（只是 `is-off` 隐藏），因为首次选图的 `loadFile` 要靠 `overlayRef` 写尺寸，画布卸掉就永远加载不进来。

流程条的当前步由状态算出来，不另存一份：没图 → 1；有图没点 → 2；有点但还没有任何路径（自动 / 手动 / AI）→ 3；有路径且在图片页 → 4；切到地图页 → 5。所以「加了个点导致路径作废」会自动落回 3，提醒用户重画，而不是停在 4。

| 步骤 | 页面上 | 实现 |
|---|---|---|
| ① 导入图片 | `.lab-track-pick` 选图卡：`选择截图` 按钮 + 拖拽区 + 文件名/尺寸 | 原生 file 输入 `hidden`，只由按钮触发；`FileReader` → `drawImage` 到隐藏 canvas（`origCanvasRef`）拿 `ImageData`，图片不出浏览器。`img.onload` 里状态写「正在自动取点…」，`setTimeout(…, 0)` 再调一次 `runPoints()`——先让尺寸落到页面上，再跑提取 |
| ② 自动取点 | 提取完自动出点数 / 骨架链数 / 连通簇数 + 簇色图例，点云按簇上色 | `extractPoints()`：HSV 红判定 → 闭运算 → 连通域 → 骨架形状校准（骨架长 / bbox 对角线 < 0.95 判为圆形图标）→ 按分叉点切链 → 摊平成点云。**不串联、不排序、不重采样**，画面上就是一片点 |
| ② 自动取点 · 聚类 | 信息行里的「N 个连通簇（最大 M 点）」+ 簇色图例，点云按簇上色 | `core/tools/trackCluster.ts` 的 `clusterChains()`：链是聚类单元（链内本来连通），两链最近点距 ≤ `gapPx` 就并到一簇，并查集 + 传递闭包；簇按点数从多到少排。点云用 `CLUSTER_COLORS` 上色——**同色 = 一个连通网络，颜色一变中间就是断的** |
| ④ 画路径 · 自动画路径 | `自动画路径` | `core/tools/trackAuto.ts` 的 `autoOrder()`：链 →「点 + 邻接」图（链内相邻；每个链端点只桥接到**别的链**上 `gapPx` 内最近的点）→ 每个连通块从任一端点做两次最短路（double sweep）取**最长测地线**当主干 → 主轴之外的旁支按挂点数分流（短于 `max(30, gapPx)` 丢掉，单挂点按「往返」插回锚点，双挂点且回到主轴末尾就当环线闭合）→ `buildTrack()` 平滑 → 弧长等距重采样 → 定标。跨簇绝不接，所以「段数 ≤ 簇数」；一条连通块出一段 |
| ③ 修点 · 擦除点 / 补直线 | 模式条 `擦除点`（带画笔 8–60px）、`补直线`（点两下），`撤销修点` | `core/tools/trackEdit.ts`：`erasePoints()` 按半径删点、把被截断的链切开并丢掉 <12px 的碎段；`addLinePath()` 以 2px 步长追加一条合成链，端点自动吸附到附近轨迹。两者都重建 `points` 与统计 |
| ③ 修点 · 画点 | 模式条 `画点`：在画布上按住拖动，松手生效；拖动中画紫色草稿（虚线 + 4px 光标圈），提示「按住拖动画一段点云，松手后生效」 | `addStrokePoints()`：把指针轨迹按 2px 重采样成一条新链（`len` 按实际像素长，`area` 取图内最大链，避免新链被形状校准误杀）追加进点云，并重建统计。指针按下即 `setPointerCapture`，`pointerup / pointercancel` 都提交；单点或长度不足就提示「这一笔没落下新点」 |
| ③ 修点 · 撤销 | `撤销修点` | 三种改点操作共用 `applyDot()`：改前点云压进最多 10 份历史，撤销整份还原。**点云一变，自动/AI/手动轨迹层全部作废**（下标与段号都指向旧点云），流程条落回 3 |
| ④ 画路径 · AI 优化 | `AI 优化` + 模型下拉 | `core/tools/trackAi.ts`：还没画路径时先补一次「自动校准 + 自动画路径」，再把当前点列（抽样 ≤160 个、带原始 `index`）+ 长边 1400px 的 jpeg 交给能看图的模型。模型只返回**最小必要修改** `edits`（`insert` 补断口 / `delete` 删误检 / `move` 挪偏段）和 `reasoning`（思考过程）；`applyEdits()` 按下标应用回完整点列，所以「优化后」与「自动画路径」的点一一对应。不重跑提取——重跑会让下标错位 |
| ④ 画路径 · 叠图对比 | `图层与偏差` 抽屉：`原图 / 提取的点 / 自动路径 / AI 优化后的轨迹 / 手动路径` 复选框 + 偏差读数 + 下载 CSV | 一张 `.lab-track-canvas` 按图层重绘：算法是实线（主题色），优化后是虚线（蓝），手动路径是橙色（沿轨迹实线、不连通虚线），断口画红点，绿点新增 / 蓝圈移动 / 红叉删除；`compareTracks()` 按弧长各采 120 点，给出平均/最大偏差与长度差 |
| ④ 画路径 · 放大 / 手动布线 | 模式条 `手动布线` / `撤销一段` / `清空手动`；舞台右下缩放条（− / 适应 / + / 适应窗口 / 1:1 / 坐标） | 缩放不改位图，只改 canvas 的 CSS 宽高（`宽 = 原图宽 × 倍数`），外面 `.lab-track-view` 负责滚动，坐标换算走 `getBoundingClientRect()` 比例；手动布线见下节。手动层、地图复现、保存都把手动路径当成一个方案 |
| ⑤ 地图对齐 · 复现 + 保存 | 第二个页签：`在地图上点起点` / `用当前位置` / `用 AI 读到的起点` / 方位 / 速度 / `▶复现`；`保存为定位文件` | `core/tools/trackGeo.ts`：`GeoAnchor{像素锚点, 经纬度, 米/像素, 方位角}` 把像素旋到真北再换算；复现沿折线按米推进；保存走 `toLocationPoints()`（均匀配时间、上限 1200 点）→ `createLocation()` 写成 `.drloc` |

**为什么是这五步**：取点（阈值/骨架/形状校准）、修点（增删像素）、画路径（排序、重采样）、落图（定标、方位）是四类完全不同的判断，而且每一步都要用人眼核对上一份中间结果。混着跑，用户看到一条线时无法判断错在阈值、错在漏点还是错在排序。分开之后，点云是第一个可核对的产物（点在不在红线上、图标有没有被丢掉），修完点再画线，改的是「哪些像素算轨迹」这一层，画路径可以反复换算法重画而不用重新扫图；最后才谈地图，因为像素到经纬度还缺一个锚点。AI 作用在「画好的路径」上，所以重新画会清掉 AI 层（下标失效），手动路径按像素保存不受影响。

**为什么先聚类、再画路径**：像素取完点之后，「谁和谁是一伙的」是独立于「先后顺序」的事实——两条相距 120px 的红线都在图上，但中间没有像素，它们就是两个网络。聚类把这件事先明确成数据结构（`clusterOf` + `clusters`），后面几种画法都吃同一份结果：自动画路径只在簇内建图（跨簇不接，所以不会出现斜穿全图的假直线）；手动布线在图上找路，跨簇自然找不到路、按设计拉直线；AI 只在画好的点列上做局部增删改，不改变簇的划分。聚类单元选「链」而不是原始像素：链内本来连通，需要判断的只是链与链的最近点距（`gapPx`），几十条链两两算最小距离足够快，避免了几千个像素的平方级比较。

**自动画路径为什么是「最长测地线」而不是「排序串链」**：参考页面那类做法是把点按 x/y 排一遍再 BFS，路口一分叉就画歪，环线还会被切成两半。这里先把点连成带权图，再找这张图的**近似直径**：任取一个端点做一次 Dijkstra，最远的点一定是直径的一端（图上的 double sweep 性质），从它再做一次，最远点就是另一端，两次最短路之间的路径就是主干。这样在分叉口会自然选择「更长的那条继续走」，短枝被识别为旁支而不是主路；旁支不是简单丢掉（可能是真的要走的支线），而是按挂点数量处理：单挂点且够长就插回锚点并原路走回（点复用，长度算两遍），双挂点且正好回到主轴末尾就当作环线在末尾闭合。环线因此只画一遍，不会沿原路返回。

**擦除点 / 补直线 / 画点为什么改点云本身**：误检的图标、漏提取的一段，错的都是「哪些像素算轨迹」，在画好的线上修只能得到一条和点云对不上的线，下次重画又回来。所以这三个操作直接改 `dotRes`（`erasePoints` / `addLinePath` / `addStrokePoints`），改完重新聚类、重新计算统计，画路径时自然用的是新点云；代价是旧的轨迹层全部作废，这也是「撤销」要整份快照的原因——只回滚点云不恢复轨迹会导致两边不一致。历史只留 10 份，避免大图点云把内存吃满。画点走的是指针轨迹而不是「点两下」，因为要补的往往是弯道或整段缺失的边，拖一笔比逐点点击省事，重采样后接进点云的形态也和提取出来的链一致。

**手动布线为什么是「A→B 找路」，而且走的是点云**：手画一条贴着红线的曲线永远不比已有骨架准，还要处理抖动与平滑；用户真正想表达的通常只是「从这里，沿这条路，到那里」。所以点 A 再点 B，`core/tools/trackRoute.ts` 的 `buildPointRouteGraph(chains, linkPx, stepPx=2)` 直接拿**提取出来的点云**建图：每条链按 2px 抽样成节点，链内相邻点连边（权重 = 像素距离），每个链端点再桥接到**别的链**上 `gapPx` 内最近的点（用空间桶找，`linked` 集合去重），所以链与链之间只要够近就是通路的。图吃的是 `dotRes.chains` 而不是画好的轨迹，因此**还没点「自动画路径」也能手动布线**，而且擦点/补点/画点之后重连立刻生效（`dotRes` 一变图就重建，`manualAnchor` 清空）；A/B 两下都在 18px 内吸附到点云上。找不到路（跨连通簇、中间真的没点）就按设计拉一条直线（图上橙色虚线），和「这里没有路」的直觉一致。A→B 默认走**带转角惩罚**的版本（`TURN_K = 0.8`）：在「有向边」上跑 Dijkstra，代价 `w × (1 + k × (1 − cosθ))`，直行不加钱、急转加价，所以路口不会来回切、沿点云走出来的线更顺；最后用 `smoothShortestPath` 抹掉抽样台阶。撤销会把起点接回上一段的末尾。

**重复路径（点复用）**：手动路径是**有序点列**而不是像素集合，A→B→A 会在序列里出现两遍同样的坐标，长度、地图复现、保存都按两遍算，统计里的「重复经过 N 点」就是重复走的部分——不做任何去重。自动画路径的往返支线同理。

**尺度一致性**：页面上的米/像素优先取画路径结果的定标值，还没画路径时直接用手填的 `比例尺 米 = 像素`，所以只填比例尺也能落图/保存。AI 报的比例尺与里程同样只补空位，不覆盖用户手填。方位角是「截图正上方相对真北」的顺时针角度，0 = 截图正北朝上。

**为什么 AI 只改不重画**：像素阈值法已经把「红线在哪」做得准，错误集中在断口、图标误检、整段平移三类。让模型从零描一条线，等于把已经正确的部分也重算一遍，偏差更大，也说不清改了什么。所以提示词明确要求「最小必要修改」并附上 `reasoning`；页面上把思考过程与每一处增删改（改哪个点、改成什么、理由）直接摊开，方便人工复核。模型返回的下标越界、`move` 缺坐标、同一下标重复操作都会被丢掉，`edits` 上限 600 条。

**回归**：`node tools/e2e/lab-track-e2e.mjs`（T1–T10：两个页签与默认页、选图按钮有样式且原生控件隐藏；导入图片后**不点按钮**自动出点云（报点数/骨架链/连通簇、画布变化、状态里明说「还没有画路径」），五步流程条依次出现且当前步落在「3 修点」；点云按所属簇上色；`自动画路径` 才得到轨迹段与点数且段数 ≤ 簇数（当前步变成「4 画路径」）；两片互不相连的轨迹聚成 2 簇并用两种颜色画、自动画路径仍只出 2 段（不跨簇硬接）；AI 优化先把「图片 + 带 index 的点列」发给模型并应用 `edits`、思考过程与三处增删改逐条展示且偏差重算；五层复选框逐层开关都改变画布；缩放按钮（+ / 1:1 / 适应窗口）真的改画布宽度；手动布线 A→B **沿提取出来的点云**走（状态写「沿点云走过去」）且在空白处拉直线、原路返回计入「重复经过」、撤销/清空；擦除点后点云减少且轨迹作废、撤销修点后点云复原；补直线后点数增加且画布上真的有线；**画点**：按住拖一笔后点数增加、提示「加了 N 个点」、路径作废、流程条回落，撤销后点云复原；手动方案能进地图复现与保存且点数一致；地图复现能推进并停止；保存后在「功能面板 → 定位 → 文件」里能打开）。脚本自带静态服务器与假视觉模型，先 `pnpm build` 再直接跑。

### 1.15 连续定位：壳里交给原生前台服务

**问题**：页面「自动打点」是 1s 的 `setInterval`，WebView 退到后台后 JavaScript 定时器会被系统冻住，记录就断了。壳（`geckoview_example`）新增了一个前台服务 `LocationTrackingService`：退到后台、熄屏照记，连续打点策略（`nextSampleMs()`）和 `appendPoint()` 去重都是页面那套的原生复刻。

**连续打点策略**（v1.1.0 起，页面与壳同一份规则）：

- `fixed`：每次固定等 `intervalBaseMs`（默认 1s）。
- `backoff`：`n` = 连续落在同一个点的次数（去重命中 +1，新增点归零），下一次等 `min(base × 2^n, max)`。默认 1,1,1,2,4,8,16,32,64,64… 秒。位移产生新点就把 `n` 清零，走动时回到 1s。
- 参数随 `location.setConfig` 一起推给壳：`strategy` / `intervalBaseMs` / `intervalMaxMs`。页面自己跑定时器时用同一个 `nextSampleMs()`；面板「连续打点」下拉可切换两种策略。

**分工**：壳里连续记录归原生，页面只做三件事——推配置、收点、补历史。普通浏览器没有桥，原样走页面定时器，两套互斥。

| 环节 | 谁做 | 怎么走 |
|---|---|---|
| 配置 | 页面 | `localStorage['dr.autoLocation']` 存 `{enabled, thresholdM, strategy, intervalBaseMs, intervalMaxMs}`；壳在 `onPageFinished` 主动读一次，所以页面就算没调桥，原生也有最新配置 |
| 开关 | 页面 | `location.setConfig`（`enabled` 变化即启停原生服务）；停止时也推一次 `enabled:false` |
| 配置改动 | 页面 | 阈值输入框逐键触发，存档同步写、桥调用压 400ms 抖动，只发最后一次 |
| 记录 | 壳 | 原生服务写自己的 JSONL，并推 `location.point` 事件 |
| 落盘 | 页面 | 事件点与 `location.getHistory` 的点都走同一个 `appendPoint()` 写进当前 `.drloc` |
| 补历史 | 页面 | 启动接管、文件读完后、`visibilitychange` 回到前台，各拉一次 `location.getHistory` |
| 重启接管 | 页面 | `dr.autoLocation.enabled=true` + 桥在 → 问 `location.status`：在跑就挂上，没跑按存档再推一次 `setConfig` |

**游标**：`location.getHistory` 每次返回全量（壳不分文件），所以用 `localStorage['dr.autoLocation.cursor']` 记「已合并到的最大原生时间戳」，只合并更新的点。用时间戳而不是壳的 `rev`，是因为 `location.clearHistory` 会把 `rev` 归零。游标在持久化成功之后才前进。

**自启动开关在壳里退居次要**：原生服务本来就按 `enabled` 起停，刷新 / 重开应用时页面按 `enabled` 接管——不能因为没勾「自启动」就把正在跑的服务显示成没开（否则原生记的点没人合并）。`dr.svc.autostart` 仍管普通浏览器里的页面定时器。

**坐标**：原生给的是 `LocationManager` 的 WGS-84，页面记的是 GCJ-02（高德底图 / `fallbackBrowser` 都转成 GCJ），所以合并前统一 `wgs84ToGcj02()`。不换算的话同一份 `.drloc` 里会混进两套坐标系，图上偏几百米。

**降级**：不问「在不在壳里」，只问「壳有没有 `location.*`」——`nativeLocationSupported()`
发一次 `location.status`，有人回就交给原生前台服务，没人回 / 回 `ok:false` 就页面定时器自己上。
结果按一次页面加载缓存，探过就不再等。旧做法是看 `<html data-gv-bridge-injected>` 注入标记，
2026-10-26 连同 `pairing.ts`（版本配对卡、版本条的壳那半）一起删了：注入标记只说明壳的适配
脚本跑过，壳把定位整条删掉之后它照样是「已注入」，页面会永远误判成「壳里有原生服务」。

**取证与后台判读（0.3.x-tune 起）**：壳多了一组诊断动作——`location.setDiag{on}` 把采样压成每秒一次并逐拍写 `files/bg_journal.jsonl`，`location.journal{since,tail}` 把账本回给页面，`location.clearJournal` 清空。行种 `tick|skip|fix|fail|screen|start|stop|taskRemoved|destroy|probe|wake`，其中 `probe` 是空档解剖（墙钟 / `elapsedRealtime` / `uptimeMillis` 三个时钟各走了多久 + 当时的 Doze、省电、GPS 开关、唤醒锁），`wake` 是 60 秒一次的闹钟对照。判读口径全部写在磨合台页（`public/location-lab/`，线上 <https://totooicu.github.io/DatingRecord/location-lab/>，网页 main 已带，gh-pages 的 `assets/location-lab/` 那份手工页仍在）的「休眠分析」卡里：`gapUp ≈ gapWall` 是进程被冻、`gapUp` 少一大截是整机深睡、空档前有 `stop` 行是被停、一拍不缺却没有 `fix` 是醒着取不到点。网页侧封装在 `locationNative.ts`：`nativeSetDiag` / `fetchNativeJournal` / `clearNativeJournal`。

三条容易踩的实测结论：**① 取证开着时 `strategy` / 间隔全被钉在 1 秒**（壳里 `nextInterval()` 第一条分支），要看退避必须先关取证；**② 覆盖率不等于活着**——取证节拍是「等上一发落定 + 1 秒」，熄屏下每发等满 1.8 秒看门狗就把平均节拍拉到 2 秒多，秒位填不满但不是漏拍；**③ 三件套齐了也可能被冻**，国产 ROM 的「允许后台行为」不放行时前台服务 + 唤醒锁 + 电池加白照样停摆（放行前 15%、放行后 98%）。

**界面**：壳里运行时面板阈值行下方一行小字「记录由安卓壳的原生服务接管…」，服务页那行的备注是「由壳的原生服务记录，退到后台也继续」。

**回归**：`node tools/e2e/location-native-e2e.mjs [url]`（N1–N5）。用 `addInitScript` 装假壳（注入标记 + `location.*` + `location.point`，原生点与运行态放 `sessionStorage` 以撑过刷新）：N1 开始打点推 `enabled=true/thresholdM=5` 且页面 GPS 一次没取；N2 事件点落进文件并按 GCJ-02 显示；N3 远处新增、原地重复只刷新时间；N4 刷新后接管（问 `status`、拉 `getHistory` 补挂起期间的点、再刷新不重放）；N5 改阈值与停止都同步给壳。

### 1.16 返回键：壳转发事件，页面决定退到哪

**问题**：这是个单页应用，页面切换全在 React 状态里，从不写 `history`——`WebView.canGoBack()` 永远是 false。壳如果自己 `finish()`，用户会从任意子页直接退出应用。

**壳的做法**（`WebViewActivity.onBackKey`）：页面加载完后不再自己退，而是发 `ui.backPressed`（`data.atRoot = !canGoBack`，只说明 WebView 历史栈），并起一个 3 秒定时器；页面用 `ui.goBack`（已退一层）或 `ui.finish`（退出应用）回执，回执即取消兜底。3 秒没动静，壳按 `canGoBack ? goBack : finish` 兜底。

**页面的顺序**（`src/ui/back.ts` + `App.handleShellBack`），和屏幕上的返回按钮保持一致：

1. 浮层：后进先出。`Modal` 与聊天 / 正文编辑的全屏态各自 `pushBackLayer()`，最后打开的先关；
2. 人物 / 事件集详情 → 列表（`backToList()`，保留「从成果详情跳来」的来路）；
3. 服务 / 任务页 → 来之前那一页（`returnView`）；
4. 设置子页 → 父级（`parentOf`），父级为空则回目录；
5. 日历点进来的「只看某天」时间线 → 日历；
6. 以上都没有 → `ui.finish`。

每一次页面自己退了一层都回 `ui.goBack`。因为 SPA 不写 history，这个回执不会让 WebView 再多退一格，作用只是告诉壳「这一下已经用掉，别兜底」；列表 / 时间线 / 日历的根上不冒充 `goBack`，直接 `finish`。

**事件订阅要能独立工作**：返回键用不着发任何请求，页面刚起来可能一次 `invoke` 都没有，所以 `onBridgeEvent()` 自己会装 `message` 监听，不依赖别处先调过桥。

**回归**：`node tools/e2e/shell-back-e2e.mjs [url]`（B1–B6）。假壳除了应答 `ui.goBack / ui.finish`，还照抄了 3 秒兜底并计数：B1 详情回列表且等过 3 秒兜底仍为 0；B2 图标弹窗只关弹窗、详情不动；B3 设置子页 → 父级 → 目录 → `ui.finish`；B4 日历某天 → 时间线 → 回日历；B5 新建事件弹窗里的全屏编辑先退全屏再关弹窗；B6 列表根上返回只发 `ui.finish`。

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
- 标题上方的版本条显示两个时间（`VersionStrip`）：「壳:…」是壳在 `getEnv()` 里上报的 `builtAt`，「网:…」是网页构建设入的 `__BUILD_TIME__`，两边统一折到 Asia/Shanghai 才可比；不在壳里时只剩「网:…」，老壳不报时间则退回显示壳版本号。**双击这一行重新加载页面**，用来确认线上是不是最新版。SW 的导航请求是网络优先，刷新一次就能拿到新的 `index.html`；双击前关掉双击缩放与文字选中（`touch-action: manipulation` + `user-select: none`），否则手机上第二下会被当成缩放/选词。

### F-P07 人物详情 — P0

**2026-10-28 输入修复**：姓名用本地草稿承接按键，失焦/非 IME 回车提交一次，空白回退；属性输入聚焦期间冻结顺序，避免粘贴后移位，离开字段才恢复排序。文本、长文本及标签属性的候选来自同一 key 的已有公开人物资料；通用标签候选来自公开人物/事件，心情来自公开事件；按使用次数排序、去重、匹配输入后最多展示 20 项，敏感属性不提供候选，不另存输入历史。`person.inputChoices` 提供同源 AI/CLI 查询。回归见 `tools/e2e/person-input-e2e.mjs`。

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
- **显示优先级**：自定义图标 → 老头像 `avatar`（`file:<id>`）→ **文字颜色头像**。
  没设图标时不再用固定的渐变圆 / 粉底方块：`defaultTextIcon(name)` 取名字首字，
  再按名字散列从 6 组浅底深字里挑一组，同一个人每次都是同一颜色。
  `Avatar` 与事件集图标共用 `CollectionIconView`，只是外形保持圆形。
- **写入口 `setPersonIcon()`**：与 `setCollectionIcon()` 同构，幂等、单独 oplog，`null` 恢复默认。
- **文件引用一视同仁**：`personsUsingFile()` 同时匹配 `avatar` 与 `icon_json.fileId`；
  `fileStillReferenced()` 把人物图标算作引用；文件合并时 `rewriteRefs()` 会改写
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

**2026-10-28 表单更新**：事件开始/结束时间改为普通文本，唯一格式 `YYYY-MM-DD HH:mm`，各自提供「获取当前时间」。保存时严格检查真实日期与先后顺序，失败在字段下提示并拒绝写入；未知时间不填、模糊时间保留原文。地点文本与地图坐标并存，地图支持点击、拖动和当前定位，坐标存 `place.geo`，编辑往返保留 `address` 与 `geo`，只有显式清除才移除坐标。回归见 `tools/e2e/event-input-e2e.mjs`。

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
- **2026-10-28 UI 更新**：事件评分不再用下拉框，改复用人物属性「好感度」那套星级控件
  （`src/ui/attr/basic.tsx` 的 `Stars`，`.stars` / `.star` / `.star-on`）。两处同一交互：
  点亮到第 n 星，再点同一星清空为未评分（落库时 `metrics.rating` 缺省）。
- **2026-10-28 布局**：事件表单里一行填得完的字段（类型、呈现形态、时间类型、精度、开始、结束、
  时间原文、地点、评分、花费、心情、亲密度增减）用 `<Field inline>` 与字段名同行；标题、参与者、
  标签、所属事件集、关联事件、正文仍保持字段名在上。人物属性行本来就是「属性名 120px + 控件」
  的同行网格，未改动。
  回归见 `tools/e2e/event-input-e2e.mjs`。
- **边界**：币种默认 CNY；金额为 0 或空不报错。
- 验收：这些字段可被筛选，并聚合到人物/集合统计。

### F-E05 正文与附件 — P0

**2026-10-29 显示名唯一规则**：`name` 去除首尾空白后完整、区分大小写比较，扩展名保留大小写。上传、新建、映射、导入和同步的新附件共用 `core/files/displayNames.ts`，冲突从 `_2` 编号，已编号名称继续递增；空名称回退「未命名」。全库占名检查包含隐私文件，不用受过滤的 `listFiles()`。主动改名冲突时**三个出口**：「使用建议名称」（本文件拿编号名）、「占用此名」（本文件拿走该名称，原同名文件——含隐私文件——自动编号）、「放弃改名」（保持原名）；`takeFileName()` 只动 `name`，不改 id / stored_id / 二进制，因此内容与既有引用都不受影响。新文件一律自动编号，不存在覆盖内容的路径。导入按已有 id 跳过元数据和 blob，保证重复导入幂等；`counts.renamedAttachments` 反馈自动命名数量。

文件页拆成两页后，「单层文件库（不分子文件夹）…」这段介绍只出现在**整理**页（`Settings.tsx` 的 `desc` 已移除）。整理页新增同名分组扫描、确认编号和跳去选择合并；编号保留组内最早文件名称，只改其余 `name`，过期分组拒绝执行。附件目前硬删除，删除后不再占名；快照整库恢复保留历史原貌，可再扫描整理。AI/CLI：`file.nameDuplicates`（只读）、`file.resolveNameDuplicates`（mutating，传扫描分组 name/ids）、`file.rename`（`occupy` 参数 = 占用此名）。`.drloc` 只读预览新增「播放点位 / 暂停播放」：每 200ms 前进一点，末点自动停，滑块与列表键盘操作互不干扰，原始文件照旧不写。回归：`tools/e2e/file-name-e2e.mjs`（并发/大小写/隐私占名/占用此名/导入/同步/歌单/定位/内容引用保持/三视口）、`tools/e2e/location-preview-e2e.mjs`（播放推进、暂停、末点自动停）。

**2026-10-29 文件分页**：沿用定位页切页杆，分「文件 / 整理」。整理页常驻显示重复 hash 管理、文件健康扫描、hash 紧密编号、判重阈值与内容寻址迁移；首次访问才挂载，往返保留扫描结果和筛选。按 hash 搜索自动回文件页。紧凑选择器不显示切页杆。回归：`dup-hash-e2e`、`file-health-e2e`（含三视口和切页保留）、`compact-hash-e2e`。

- 正文：Markdown，支持图片内联；
- 附件：存 `attachments` 表，**内容寻址（sha256 命名）**，天然去重；
- **边界**：删除事件不清空附件（引用计数归零才清理）；附件丢失时 UI 显示占位符而非崩溃。
- **引用语法**：正文里写 `![文件名](file:<storedId>)` / `[文件名](file:<storedId>)`。
  方括号里是**用户看到的文件名**（插入时的快照），定位文件只靠括号后的 `storedId`：
  改名不重写正文，既有引用照旧打开、显示也还是旧名字；只有 `storedId` 变了
  （合并 / 批量转移 / 迁移）才改写，并把方括号里的名字一起换成新文件的名字。
  老数据的空方括号 `[](...)` 仍可用，渲染时回退到文件库当前名字。
- **映射文件**（schema v11）：`attachments.source_url` 非空表示库里只存链接、二进制不落 IndexedDB。
  文件页「＋ 添加映射文件」可填 https / ftp / `file://` / 手机路径，支持测试连接、获取文件名、
  按链接 hash 生成引用名（`link-…`）、按下载内容 hash（`sha-…`）；
  「保存为映射」只落元数据，「保存为实体文件」走正常上传（判重、内容寻址都不另起一套）。
  **自定义 scheme（App 深链）也收**：`qqmusic://i.qq.com/v8/playsong.html?songmid=…`、`weixin://…`、
  `spotify:track:…` 这类只能交给手机上的 App 打开，所以 `normalizeLink()` 原样保留、只挡
  `javascript:` / `vbscript:`（`BLOCKED_SCHEMES`）；`isAppLink()` 判出后，面板把「测试连接 / hash 实体文件 /
  保存为实体文件」置灰并说明原因（`probeLink()` / `downloadLink()` 也直接给一句人话，不靠 fetch 报「连接失败」）。
  文件行把这类标成「应用深链 · qqmusic:」。正文引用同样要能点开，所以 `renderMarkdown` 的
  `ALLOWED_URI_REGEXP` 改成「任意 `scheme:`，但负向前瞻排除 javascript / vbscript / data（`data:image/` 除外）」——
  只按原白名单放行会把 `href="qqmusic://…"` 整个抹成 `<a>`。
  下载走流式读取（`downloadLink({signal,onProgress})`）：大文件显示「已下载 x / y」，随时可点
  「取消下载」或关弹窗掐断（连读带算 hash 都能停在半路），取消不落任何数据。
  渲染时 `urlForFile()` 直接返回 `source_url`，正文引用格式与实体文件完全一致。
- **判重与冲突处置**（`core/files/upload.ts`）：算得出 hash 时，同 hash **且大小不同** → 直接当不同内容，
  新记录拿顺延名（`_1`/`_2`）并置 `hash_shared`；同 hash 同大小且 ≤ 阈值（默认 1MB，`filePrefs`）→ 逐字节比，
  一样就静默复用；超过阈值 → 弹窗由人判断（逐字节比一个 50MB 视频要在浏览器里读 100MB，人看一眼缩略图更快）。
  算不出 hash（非安全上下文）只能随机命名落库，不假装去重。
  弹窗里三种处置：**复用**（不新增记录、不写二进制）/ **覆盖**（`overwriteFileContent`：只换 IndexedDB 里的二进制，
  `id` 与 `stored_id` 都不动，所以正文里已有的 `file:<storedId>` 照旧可用）/ **都不一样**（视为 hash 碰撞）。
  弹窗打开时先对每个候选试 `getBlob()`，取不到内容的标「二进制缺失」——那正是「元数据在、附件没了，文件打不开」的现场，
  覆盖是把它修好的路子（复用只会指向空内容）。勾选「这一批后面再遇到同样的冲突按这次处置」后，本批剩余冲突不再打扰，
  目标一律取各自的第一条候选；**取消上传**则这一条直接跳过，不落记录（以前取消也会插一条，等于凭空多出一个重复文件）。
- **重复 hash 管理**（文件页折叠项「重复 hash 管理 · N 组待处理」，`ui/files/DupHashSection.tsx`）：
  判重只在文件撞进来那一刻起作用，库里历史攒下的重复（改名重传、当初选了「都不一样」、迁移留下的副本）要有地方翻出来处置。
  分组口径复用 `auditFiles()`（同 sha256、≥2 条、映射文件不参与），每组默认把**引用最多的那条**留作目标（改写面最小），
  动作与上传弹窗同一套词：**合并其余到目标**（走 `MergeModal`，先看影响再执行）/ **标记为不同内容**（整组置 `hash_shared`，
  退出判重候选，以后再传同样的不再问，可取消）/ **删除无引用副本**（只删引用数为 0 的，需二次确认，删二进制救不回）。
  每组还能「在列表里搜」：把整串 sha256 填进搜索框，列表只剩这一组。
  面板收起时只做一个内存计数（不查库），展开才跑 `auditFiles()`——它要逐条数引用，文件多的库不是白给的开销。
- **hash 紧密编号**：文件页先预览再确认，将同 sha- 引用名主干、同扩展名按原序号排序为 `X、X_2、X_3…`。
  无 X 时最小编号提升为 X；历史 `_1` 也纳入重排。不修改实际文件名、ID、hash 或二进制，不合并、不删除。
  库内事件（含回收站）、聊天正文、媒体引用、人物头像/图标/备注、事件集封面/图标/描述及回忆录引用同事务更新。
  采用临时引用名避免唯一索引冲突，单次映射避免连锁替换；预览过期拒绝执行，失败整体回滚。
  歌单依靠不变的文件 ID 继续定位；外部复制的链接不更新，执行前应备份。
  回归：启动 Vite dev :5174 后运行 `node tools/e2e/compact-hash-e2e.mjs`。
- **文件健康扫描**：文件页「扫描丢失 / 无法打开的文件」，只读逐个检测，可停止。
  结果筛选为内容丢失、打开失败、无法验证及全部，列文件名、已记录的完整 hash、记录/实际大小和原因。
  图片检测解码，音视频只检测首帧，文本只读开头，不保证全文或完整播放；不重算 hash。
  不支持的媒体、超时和未自动检测的格式列为无法验证；映射链接不访问外部地址，不将其误报为丢失。
  结果为扫描时快照，修复后需重扫。回归：`node tools/e2e/file-health-e2e.mjs`。
- **搜索命中字段**：搜索框同时匹配 实际名、引用名（`sha-…` / `link-…`）、sha256 全文，大小写无关。
  用户手里的线索可能是三者之一，排查「这两张是不是同一份」时通常直接粘 hash。
- **预览兜底**：浏览器放不出内容时（未知类型、图片/视频/音频解码失败、远端链接失效），
  预览弹窗显示放大的扩展名（无扩展名时用 MIME 子类型），并保留下载 / 新标签页打开两条出路。
- **批量转移**：文件页「谁在用」里勾选若干事件，选目标文件 b，就把这些事件正文里对 a 的引用整体换成 b
  （`transferRefsInEvents()`，只动被勾选的事件；头像 / 图标不走这条路，交给「合并」）。
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
  事件集 chip 不做层级缩进、也不加 `└` 之类符号——缩进在 chip 内表现为一块左空白，
  符号自身还要再占宽，选项排布保持均匀，层级由「事件集」页的树形结构承担。

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
- **自定义配色**：前景 / 背景在预设色块之外还有「＋」，展开统一取色面板（彩虹渐变 +
  历史色 + HEX / RGB，见 1.13）；图片类只给背景色。选过的颜色进全局历史
  `dr.recentColors`，下次在任何取色入口都能直接点。
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

- **格子上方日期、下方一行滚动事件条**：每条是「事件集图标 + 事件名」，占满格子宽度；
  放得下就静止，放不下就把内容复制一份、向左匀速滚动（`DayTicker`，实测内容宽度后
  `animationDuration = 内容宽 / 12`，`prefers-reduced-motion` 下不动）。
  高度因此只比日期文字高一点：手机 36px、宽屏 46px（以前是 56 / 74px 的图标堆叠）。
- **默认图标**：事件没设图标时，`CollectionIconView` 用 `defaultTextIcon()` 生成文字颜色头像，
  和人物头像同一套配色散列。
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
- **区间事件逐日展开**：1→3 号的事，1、2、3 每格都计数（`dayKeysBetween` 逐日推进），
  但只有单日事件会进格子里的滚动条——跨天事件已经有横条，逐日重复标题只会更乱。
  `endTs` 缺失/非法/早于 `startTs` 时退化为单日；异常超长区间最多展开约 10 年，防卡死。
  日键推进用本地零点构造 `Date` 再 +1 天，跨月/跨年自动进位，仍不走 `toISOString()`。
- **跨天事件横条（SpanBar）**：跨天事件在所属周的日期格下方
  画一条横跨多列的色条（`collectSpanBars` → 月内裁剪 → 贪心分配 `lane`，先长的后短的，
  同一行不重叠）。跨周事件每周各画一段、首尾相接；跨月事件只画本月部分，被裁的端点显示
  ◀/▶ 延续箭头。点条 → 与点格子相同，回时间线只看那天。条内显示集合图标（复用
  `CollectionIconView`）+ 标题，超长省略。**底色跟事件集走**：集合图标自带 `fg/bg`
  就直接用；没设图标的集合用集合名跑 `defaultTextIcon()` 的散列色（和它的默认头像同色）；
  一条集合都没挂的事件退回主题色（`color-mix(in srgb, var(--primary) 10%, var(--panel))`）。
  不再写死粉色，换主题或改集合图标颜色，日历跟着变。
- **筛选（人物 / 事件集）**：月卡片上方两枚胶囊按钮，点开是多选弹窗（手机 390px 放不下内联多选）。
  `CalendarFilter { personIds, collectionIds }` 在 `Calendar` 层持有，切月份不丢；
  组内 OR、组间 AND；事件集筛选走闭包表 `descendantIdsOf()`，选父集合自动含全部子孙。
  `collectDaySummaries(filter)` / `collectSpanBars(month, filter)` 共用 `makeMatcher()`——
  判定放在日期展开之前，被过滤的事件既不计数也不出图标、不出横条；空数组 = 不筛选。
  筛选只影响显示，不改数据，也不影响「N 天有记录」之外的时间线内容。
- **切月份**：不再有左右箭头。手机在日历上**上下滑动**翻月（`MonthView` 里注册非 passive 的
  `touchmove`，确认纵向后 `preventDefault()`，否则页面先滚、月份切不动；弹层内的滑动不受影响）；
  手指上推 = 下个月。点标题里的年份 / 月份打开选择器：
  月份是 3×4 网格，每格显示「N 件 / 没有记录」；年份是可滚动列表，同样带全年计数，
  范围覆盖有记录的年份并在当前年两侧各留 5 年。计数由 `collectMonthCounts()` 一次遍历得出
  （跨月事件在覆盖到的每个月各记一次）。
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
内容没变 → 名字没变 → 云端已有 → 跳过。

> **定长切片的边界（实测）**：只有「等长替换」才只让 1 片换名字。插入 / 删除会让后面**所有字节挪位**，
> 于是之后的每一片都算新内容、全部重传 —— 改文章中间一句话 = 后面整库重传。
> 治法是换成分块内容寻址（变长切点，如 FastCDC：指纹不变就复用），排在附件同步（F-S01d）之后单独一轮。

| 文件 | 职责 |
|---|---|
| `core/sync/sha256.ts` | 纯 JS 增量 SHA-256。`crypto.subtle` 是一次性的、且纯 http 局域网下不可用 |
| `core/sync/chunk.ts` | `CHUNK_SIZE = 64KB`、`hashChunks`、`digestOf`（整库摘要） |
| `core/sync/manifest.ts` | 远端清单结构 + `knownHashes` / `missingChunks` |
| `core/sync/snapshot.ts` | 快照生成 + **稳定序列化** |
| `core/sync/webdav.ts` | MKCOL / PROPFIND / PUT / GET / DELETE + Basic 认证；两条传输通道的选择点（见 F-S01c） |
| `core/sync/nativeHttp.ts` | 壳的网络代理客户端：`net.capabilities` 探测（一次页面加载内缓存）+ `net.request` 收发 |
| `core/sync/mergeRows.ts` | 远端快照 → 本地（按 hlc 合并，与 `importLibrary` 同一套规则） |
| `core/sync/attachments.ts` | 附件二进制的云端往返：内容寻址切片、补齐、跳过（见 F-S01d） |
| `core/sync/engine.ts` | 三方比对 + 只传变化分片 + 调度附件往返 |

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
- 附件字节**不进快照**（`kind: 'lite'`），快照只带 attachments 的元数据行（`data` 一律清空）：
  别的设备据此知道「有这张图、多大、指纹是什么」，字节另走 `attachments/`（F-S01d）。
  字节塞进快照的话，首次同步会一口气推几十 MB，而且每次本地都要白算一遍哈希。
- 远端快照只留最近 10 份，`pruneSnapshots()` 按文件名排序淘汰。
- **坚果云不返回 CORS 头**，浏览器直连必被拦。两条出路：走壳的网络代理（F-S01c，装了壳就是这条路，用户不用部署任何东西），
  或把 `DavConfig.base` 填成自建反代（F-S01b）；测试时也用本地转发代理（`proxy.mjs`）绕过。

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

#### F-S01c 传输通道：优先让壳代发 HTTP（桥的 `net.*`）

反代要用户自己部署一个服务，普通人做不到；而跨域这件事**客户端代码根本绕不过去**——
不是 fetch 的用法问题，是浏览器在发请求前就把非标准动词（PROPFIND / MKCOL）的预检拦死了。
唯一不需要用户额外部署的东西是**已经装在他手机上的壳**：壳跑在系统网络栈上，不受同源策略约束。

于是分工定成这样，业务逻辑一行都不搬到壳里：

| 层 | 文件 | 职责 |
|---|---|---|
| 通道客户端 | `core/sync/nativeHttp.ts` | 只搬数据：探能力、把一次 HTTP 变成一次 `net.request`（base64 收发） |
| 传输选择 | `core/sync/webdav.ts` | `request()` 一次调用里决定走壳还是走 fetch；两条通道共用同一套状态码翻译 |
| 同步逻辑 | `core/sync/engine.ts` | **不感知通道**——只看 `DavResponse` 的 status / text / bytes |

规矩：

1. **能力靠探测，不靠猜环境**：`net.capabilities` 发一次 action 看有没有人回，并要求它明确支持
   `PROPFIND` + `MKCOL`；不读 UA、不看注入标记（同 §1.14 的桥纪律）。探测结果**一次页面加载内缓存**——
   一次同步要发几十条请求，每条都问一遍壳会白等几十次超时。
2. **错误语义分工**：壳返回的错误串（超时、TLS、地址不合法）在壳里就已经写成给用户看的话，
   网页**原样上抛**，不再翻译；只有浏览器 fetch 自己的死路才补那句「装壳 / 配反代」两条出路。
   网络问题却让用户去配反代，是最坏的提示。
3. **二进制过桥用视图**：`bytesToBase64` 按 `subarray` 逐段编码，偏移不会错；只有交给 `fetch` 前
   才复制成独立 `ArrayBuffer`（`fetchBody`）。
4. **上限在壳侧硬挡**：请求体 12 MB、响应体 32 MB、超时 120 s；网页多等 5 秒，让壳先超时，
   错误串才有意义。分片只有 64 KB，离上限很远。
5. **3xx 不自动跟随**：`Location` 原样回给页面，要不要跟由业务判断。

桥契约（参数名、上限、`ok:false` 的含义）写在**壳仓库** main 线 `docs/NET_BRIDGE.md`
（坚果云测试线的 `docs/ADAPTATION_GUIDE.md` §4.5 是同一份契约）；
`net.*` 是纯新增命名空间，`proto` 保持 1，老壳收不到就是自动退回浏览器路径。
诊断入口：`system.syncChannel`（AI / CLI / 页面三处同一条结论），设置页顶部也常驻一行「传输通道」。

**回归**：网页侧 `tools/e2e/nutstore-bridge-e2e.mjs`（B1–B12 + U1/U2）；壳侧 `tools/net-http-test/`（假坚果云 + 25 项断言 + `--live` 打真 dav.jianguoyun.com）。
两边不重叠：网页侧证明「请求确实交给桥了」，壳侧证明「非标准动词、chunked、无 Content-Length、超限、TLS 与超时确实发得出去、报得清楚」。

#### F-S01d 附件二进制的云端往返（attachments 层）

用户要的是「文件也要上传到坚果云」，但把 base64 塞进快照是坏主意（几十 MB 一次推完、每次同步白算一遍哈希）。
所以字节单独一套，元数据仍跟着快照走 —— 这一套的成立前提是快照里能看到 attachments 行，
而以前 `buildLibrary({ includeAttachments: false })` 直接返回空数组，别的设备连「有这张图」都不知道。
改成 `'meta'`（只取元数据、`data` 清空）之后，**每台设备的 digest 都会变一次**，
首次升级会触发一轮整库分片重传，这是已知且接受的一次性代价。

远端布局与命名：

```
<远端目录>/attachments/index.json        sha256 → { 字节数 s, 片数 p }
<远端目录>/attachments/<sha256>/<i>.bin  切片，一片 4MB
```

对象名就是内容的 sha256，一次解决三件事：传没传过（查 `index.json`，不问服务端）、
两台设备传同一张图（落在同一个名字上，覆盖的是同样的字节）、拉回来的对不对（拼完重算 sha256 与名字比对，
上次断在半路的文件当场露出来）。**片数取 4MB** 是算出来的：壳的请求体上限 12MB、base64 还要胖 4/3，
40MB 的视频 = 10 个请求，断了从没传完的那片接着来，而不是换上限。

| 规矩 | 为什么 |
|---|---|
| 只在真要传 / 真要拉时读那一个文件的字节，读完就撒手 | 曾经一趟循环把所有附件的 `Uint8Array` 存进一张 Map，两百张照片 = 六百 MB，手机直接杀进程。队列里只允许放 id、哈希、大小 |
| 先补齐再上传 | 刚合并完远端的行时本地正缺字节，先拉才能在本次同步里把两端对齐 |
| 附件阶段在 `noop` 路径上也要跑 | 新机器 / 只看不改的设备全靠这条路补字节；用户刚打开开关、或上次拉到一半断了，也在同一条路上修好 |
| 片不全或重算的哈希对不上名字 → 当「云端没有」 | 宁可缺一章，绝不把错内容写进库（写进去之后每次同步都在拿错的做增量） |
| 云端清单解析不出来直接报错停 | 当成空清单 = 让所有附件重传一遍 |
| 映射文件（`source_url` 非空）不传不拉 | 它本地就没有字节 |
| 老行没 `sha256` 时当场补算并 `persist()` | 光改内存里的 sql.js 副本，刷新就没了，下次同步又白读一遍字节 |
| 每个对象上传前先 `MKCOL attachments/<sha256>` | 真实 WebDAV（含坚果云）不接受「父集合不存在」的 PUT，直接 409（RFC 4918 §9.7.1）。本地假服务端当初来者不拒，于是真机 409、本地全绿——两套假坚果云现在都按这条硬回 409 |
| 开关关掉时 `manifest.hasAttachments` 沿用远端原值 | 别把别人传上去的对象说成「没有」；这个字段是「恢复时要不要顺带拉附件」的依据 |
| `nutstore.att`（开关）默认开 | 只有明确存过 `'0'` 才算关；老库没这个键，默认要跟着「文件也要上传」走。它是设备各自的偏好，`buildLibrary` 的 `meta` 是固定几个字段，所以这个键本来就不会进快照 |
| 进度文字单独一行，不进按钮；传输中「立即同步」和「保存设置」一起禁用 | 2026-10-30 用户报「文件名在上传按钮中显示，会导致上传按钮过长」：`.btn` 是 `white-space: nowrap`，把「上传附件 一张很长的照片.jpg 第 1/3 片 · 11.4 MB」塞进按钮就成了一条横幅（回归里实测撑到 305px）。按钮只说「同步中…」，文件名放下面 `.sync-progress`（`overflow-wrap: anywhere` 可折行）。「保存设置」以前不禁用——中途改账号/目录看着会生效，其实这一趟用的是点同步那一刻存下的配置。另外全站补上 `.btn:disabled`（半透明、hover 不变色）：以前禁用态和可点态长得一模一样，用户只能靠「点了没反应」判断它在忙 |

诊断入口 `system.syncAttachments`（只读本地，不联网、不含密码）；
回归 `tools/e2e/nutstore-attachments-e2e.mjs`（A1–A11，44 项断言，含「云端片被截断不写坏库」
与「补算的指纹刷新后还在」两条真会踩的坑，A8 那组是整段传输过程按 60ms 采样按钮文案、宽度与禁用态——
假服务端只对 `attachments/<sha>/*.bin` 的 PUT 延 0.9 秒，本地回环否则快得抓不到「正在传」那一帧），
通道侧 `nutstore-bridge-e2e.mjs` 另加一条 B13：
409 必须报成「上一级目录还没建好」，而不是甩一个数字。

#### F-S01e 自动同步服务（定时 + 有变化就同步，开软件自启动）

以前「打开应用时自动同步一次」（`nutstore.auto`）是个**死设置**：存进 meta，没人读。
这一节是它的使用方，并加上两种节拍。做成服务而不是设置页的一个开关，是因为它要满足
`core/runtime` 那套「服务」的三条规矩：常驻状态进 head、能自启动、用户能在服务页看到它在干什么。

| 文件 | 职责 |
|---|---|
| `core/sync/auto.ts` | 服务本体：注册 + 节拍判断（`tick`）+ 跑一趟（`runPass`）+ 状态对外（`autoStatus`） |
| `core/db/persist.ts` | **本机有没有新东西要传**的判据：`syncWrite` / `currentWrites` / `markSynced` / `pendingLocalWrites` / `lastUserWriteAt` |
| `core/sync/engine.ts` | 单飞队列（`isSyncing`）、`syncPoint` 对齐点、同步自己的写入打括号 |

三种触发，共用一条 `runPass`：

| 触发 | 条件 | 说给用户听 |
|---|---|---|
| `boot` | 服务起来那一刻（开软件 / 勾上开关） | 开软件 |
| `timer` | 距上一趟 ≥ `everyMin × 60s` | 定时 |
| `change` | `pendingLocalWrites() > 0` 且最后一次写入已安静 `quietMs`（默认 1 分钟） | 本机改动 |

**这套东西唯一真正难的点是「别自己喂自己」**。同步引擎自己也写库：合并进来的行、闭包补算、
补算出的 `sha256`、`sync.baseline`、`sync.last_at`。这些要是算成「本机有新东西」，
每跑完一趟都会立刻满足改动触发的条件，自动同步就一趟接一趟打坚果云。
做法是在最底层（`markDirty` 是所有写入的必经之路）记两个序号：

```
userWrites    业务写入次数（syncWrite() 里的一律不计）
syncedWrites  最近一趟**成功**同步在拍快照那一刻的 userWrites
pendingLocalWrites() = userWrites - syncedWrites
```

三条必须一起成立的细节，缺一条就出隐性事故：

1. **对齐点取拍快照那一刻**（`syncNow` 里 `syncPoint = currentWrites()`），不是这趟结束那一刻。
   传输途中用户又改了一笔，那一笔没进这份快照，必须仍然算「欠着」，否则定时没开时
   这次编辑会一直躺到下一次写入为止。
2. **只在成功时对齐**（`.then()` 里 `markSynced(syncPoint)`，`finally` 不行）。
   失败那趟一笔都不对齐，改动触发会自己重试同一批内容——失败的同步不能把没传出去的改动说成传过了。
3. **计数点在 `markDirty` 而不是 `persist`**。`persist` 是 500ms 防抖后的物理写，
   一趟可能合并几十次逻辑写入；「有变化」是逻辑层面的事。

其余规矩：

| 规矩 | 为什么 |
|---|---|
| 同一时刻只许一趟（`syncNow` 排队等上一趟） | 两边都在读同一份 baseline、又都要写 manifest 与 baseline，后写完的把先写完的说法覆盖掉，云端清单和两边设备的 baseline 就对不上。排队而不是并发，也**不把别人的结果回给你**——「强制完整上传」不能因为撞上一次自动同步就被吞掉 |
| 手动同步在飞时，自动那一拍直接跳过（不排队） | 用户点的那一下优先；下一拍再看要不要跑，不攒一堆无用的趟 |
| 失败后退避 `retryMs`（默认 5 分钟），期间不再试 | 对着一台回 500 的服务端每 15 秒猛打，是把一次故障变成封号 |
| 账号被清空 → 服务自己停，并留一句「还没填坚果云账号，自动同步已停」 | 静默空转最坏：用户以为在同步。起不来也要说清为什么起不来 |
| 开关**只有一个真相**：库里的 `nutstore.auto`；注册时立刻覆写服务页那份 localStorage 存档 | 服务页的自启动存档存在浏览器 localStorage，设置页的开关存在库。两边各有真相就会出现「服务页关着、坚果云页开着」这种说不清的状态——`nutstore.auto` 以前没人读，就是这么来的 |
| 节拍改动当场落库，不用点「保存设置」 | 用户不会为了「改成每 15 分钟」再多点一下保存；服务每拍重读设置，所以改了立刻生效，也不用重启定时器 |
| `everyMin` 只认 0/5/10/15/30/60，别的一律归 0 | 工具 / CLI 传进来的乱七八糟数字不该变成一个后台定时器 |
| 默认关；`onChanged` 默认开 | 新装就后台联网是坏事；但既然开了自动同步，「不想手动点」就是主要动机 |
| 节拍参数可由 `startAutoSync(tuning)` 注入 | 真实节拍（15 秒看一拍、安静 1 分钟）在回归里等不起。生产代码一律不传 |

界面：设置页 → 备份与分享 → 坚果云备份，勾「自动同步」后出现「定时间隔」「本机有改动就同步」
和一行实时状态（`autoStatus()` 翻译成人话）；服务页一行「坚果云自动同步」可开关自启动，
`svc-sub` 那行显示这一趟的理由与结果；head 上是云 + 上下箭头的常驻图标（`serviceGlyph('sync')`）。

工具（铁律四）：`system.syncAuto`（只读，不联网、不含密码）、`system.setAutoSync`（mutating，
`enabled` / `everyMin` / `onChanged` 可单独给，三条入口——设置页、服务页、工具——都走 `setAutoEnabled`）。

**回归**：`tools/e2e/nutstore-autosync-e2e.mjs`（T0–T11，66 项）。核心那条是 T5：传完之后静置
25 拍 / 8 个安静窗口，云端必须**零新请求**——把 `finish()` 的 `syncWrite()` 括号拆掉，
这一条当场变成「13 趟 vs 7 趟」，整条回归 18 项红。另两条只有在这里证得了：
勾上开关后**没有任何点击**云端就出现清单（T3），以及失败那趟的改动没被当成传过了（T7）。

> **踩过的坑（写在这里，别处也适用）**：假坚果云与假壳都在 harness 进程/页面里，模块必须拿
> **应用自己那一份实例**。Vite dev 会给「服务启动之后改过的文件」的 import 地址加 `?t=<mtime>`，
> 于是 `import('/src/core/sync/auto.ts')`（裸路径）拿到的是**第二个实例**——里面的定时器、
> 趟数、水位线全是零，看起来像「服务根本没跑」，实际是测错了对象。
> 解法：先从 `performance.getEntriesByType('resource')` 里按 pathname 找出应用真正加载过的那个
> URL 再 import（`window.__mod()`），并在开头加一条 T0 断言核对两份 import 是同一个函数。
> 跑 e2e 前把 dev 服务重启一遍也能避免，但别指望它——断言才是防线。


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
**导出只产出 `.drp.zip`**；旧的 `.drp.json` 仍可导入，但界面不再提供 JSON 下载。
边界：敏感字段**默认不导出**或按开关脱敏；导出前校验 JSON 可序列化；元数据在但二进制丢失的附件跳过，不阻断备份。

**落盘通道（2026-10-30）**：导出/下载一律走 `core/io/save.ts` 的 `saveBytes/saveText`，
不再各处自己造 `<a download>`：

| 环境 | 路径 |
|---|---|
| 浏览器 | `<a download>` + objectURL（文件名靠 `download` 属性带下去） |
| 壳（WebView，有 `file.writePublic` v2） | 先 `file.capabilities`（1.2s 超时，正负都缓存），有人回就按 2MB 分片 `file.writePublic`（`encoding:'base64'` + 首片建文件、后续 `uri`+`append`），落到手机「下载」 |
| 壳太旧（v2 之前，回的是 `unknown action: file.capabilities`） | **报错**：「这版壳存不了文件到手机『下载』，请更新壳」。这一种也会回话，靠 `isBridgeTimeout()` 与「没人回=浏览器」分开 |

壳里 `<a download>` 是死路：`blob:` 没有任何人接，`DownloadManager` 也拿不到，
用户看到的现象就是「点了导出，一点反应都没有」。所以有壳时**不许**回退到 `<a download>`
（那是二次静默失败），写盘错误原样抛给页面显示。
2026-10-31 补上第三种：旧壳也会回话，以前被当成「没有壳」，于是手机上弹出
「已开始下载 xxx」而「下载」目录里什么都没有——这条谎现在换成明说「壳太旧」。
回归：`tools/e2e/export-bridge-e2e.mjs`（E1–E7，含 5MB 分片逐字节比对；
E7 的反证写在文件头：删掉 `save.ts` 里 `if (c.answered) throw` 三行，E7 红三条）。

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
| **v4.0** | **安卓原生端 + 自动记录**：定位轨迹自动打点成事件、读取屏幕/通知自动归档、心率/运动等健康数据接入为事件属性 | v1.5 跨端抽包 |
| **v4.5** | **功能面板（暂名）**：独立的「小组件」空间，可挂多类工具卡片——① 背景音乐歌单（本地存储歌单与播放记录，事件文档可引用）；② 数据分析板（选文件库中的数据文件做清洗/统计，产出图表，图表可插入事件正文引用） | v2.5 AI-1 |

**AI 能力完整清单（31 项）见 `dating-record-ai-capabilities.md`；同步与跨端细节见 `dating-record-storage-sync.md`。**

## 3.1 暂缓的体验项

不是版本规划里的事，是「想清楚了但先不做」的视觉/交互想法。动手时直接按这里的结论来，省得重新推演。

### N-01 音乐光晕（head 播放态指示）— 暂缓

**想法**：音乐在放的时候，在页面 head 上叠一层随音乐动起来的光晕，`pointer-events: none` 不影响点击，作为「还在放歌」的全局提示。

**已讨论的结论**（动手时直接采用）：

- **位置**：放进 `PageHead` 内部，绝对定位插在 head 背景之上、文字之下（父级已是 stacking context，子元素用负 `z-index` 即可），必须 `overflow: hidden`，否则光会漏到下面的列表里。PWA 独立模式下补的 `safe-area-inset-top` 留白不铺光，只覆盖内容区。
- **亮度**：**不要 80% 不透明的整片光**。图层 `opacity: 0.8`，但渐变本身峰值 alpha 只有 10%~15%，净效果 8%~12%——44px 的 head 里挤着标题、服务/任务计数和右侧按钮，再亮就是拿对比度换氛围。参数里只有这一条不能让。
- **形态**：首选**底边律动线**（24~32 根 1~2px 竖条，高度 1~6px 起伏，顺手替代那条 1px 分隔线），叠一层极弱的横向流光。整块径向呼吸在 44px 高度里会压标题，那种更适合回忆播放器的 Modal。
- **颜色**：取当前曲目封面主色，降饱和 + 提亮；深色主题用 `screen` / `plus-lighter`（只提亮不压暗字），浅色主题改用低 alpha 实色。换歌时色相过渡 600ms，本身就是「切歌了」的反馈。
- **状态**：播放才动；暂停淡到 20% 并 `animation-play-state: paused`（别硬切 0，会闪）；停止/解除歌单淡出卸载；`document.hidden` 停 rAF，`prefers-reduced-motion` 降级成静态微光。
- **范围**：暂定只开在事件集主页 + 回忆阅读器，给 `PageHead` 加开关，不默认全站亮。
- **驱动**：先做「播放进度伪同步」——rAF 里读 `audio.currentTime`，按估算节拍脉冲，**不碰 Web Audio**。真频谱要 `createMediaElementSource`，一旦 AudioContext 被 iOS 挂起（切后台/来电/锁屏）整条链路静音，为氛围效果冒「放不出声」的风险不值。将来真要做，走 `OfflineAudioContext` 离线预分析成能量表再查表，而不是实时分析。
- **性能**：只动 `transform` / `opacity`，不动 `filter: blur()` 和 `background-position`；高频信号直接写 CSS 变量到 DOM，不走 React state（`music.ts` 每次 patch 都会重渲染整个面板）。

**动手前要定**：形态（律动线 / 横向流光）、范围（全站 head / 只在主页与回忆）、是否给用户一个「光晕效果」开关。

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
| 10 | 音乐光晕的形态与生效范围 | 本手册 §3.1 N-01 | ⏸ 暂缓（方案已定，待决定形态/范围） |
