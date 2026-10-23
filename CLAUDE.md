# 项目：约会记录软件（Dating Record）

本地优先的个人关系档案工具。核心三层：**人物 Person / 事件集 Collection / 事件 Event**。

## 铁律一：每次对话必须提交并推送 git

- 每轮对话结束前，所有改动必须进入 git。**已通过 `Stop` / `SessionEnd` 钩子自动执行 `scripts/git-sync.sh`**。
- 若发现钩子未生效、或本轮改动未被提交（可用 `git status` 确认），**必须手动补一次**：
  ```bash
  bash scripts/git-sync.sh
  ```
- 不要提交空提交（脚本会自动跳过无变更的情况）。
- 提交信息由脚本自动生成（时间戳 + 变更文件清单）；重大里程碑可手动改写为更清晰的 message 后再提交。
- 推送失败时不要中断对话，如实告知用户原因即可（改动已安全保存在本地提交）。
- **提交位置受铁律五约束**：**任何改动**都提交在**任务分支**上，一律不直接提交 `main`——包括改 `CLAUDE.md` / `DEVELOPMENT.md` 这类宪法文档，**没有例外**。脚本会提交并推送当前分支，所以开工先建分支，收工前确认 `git branch --show-current` 是预期分支（不是 `main`）。

## 铁律二：不覆盖用户数据

- `data/`、`attachments/`、`*.db` 等运行时数据已进 `.gitignore`，不入库。
- 删除操作一律软删除，附件按引用计数清理（见架构文档第 11 节）。

## 铁律五：一任务一分支，验证通过才合并，main 只许前进

用户 2026-10-23 立规，两条一起执行：

> **① 每次修改都应该创建新的分支，分支任务完成且没有问题后再与 main 分支合并。**
> **② 不与 main 冲突的前提下合并；一旦冲突，解决自己的分支，main 慎重改动。**

**分支与门禁（缺一不可）：**

1. **开工先建分支**：`git fetch origin` → `git switch -c feat/<简短名> origin/main`。**任何改动**（业务代码、bugfix、文档、样式微调，以及 `CLAUDE.md` / `DEVELOPMENT.md` 宪法修订本身）都不得直接在 `main` 上提交，**无例外**。
   - 分支建好立刻推上远端：`git push -u origin feat/<简短名>`。分支必须能在 GitHub 上看到，别人据此知道哪块正在被改；只在本地存在等于没建分支（2026-10-23 用户补充）。
2. 分支内可自由提交，有进展就 `git push` 一次，远端分支跟着更新；`main` 保持随时可发布。
3. 任务完成 + **本地构建全绿** + 自测通过 → 才允许合并：`npm run build` + `npm run build:cli`。
4. **不走 PR**（2026-10-23 用户确认）：本仓库不创建 Pull Request、不等待 CI 通过才合并，直接本地合并。因此**本地构建就是唯一门禁**，跳过构建直接合并视同违规。
5. 合并完成后删除该分支，**本地和远端都要删**（顺序：先确认 main 已推送成功，再删分支）：
   ```bash
   git push origin main
   git branch -d feat/<简短名>
   git push origin --delete feat/<简短名>
   ```
   远端分支删干净后，`git ls-remote --heads origin` 应当只剩 `main` 与 `gh-pages`。

**合并前必做（缺一不可）：**

1. `git fetch origin --prune` —— 先看远端真实状态，不看本地缓存。
2. 比对改动文件：`git diff --name-only origin/main...HEAD` 与 `git log --stat origin/main..HEAD`，确认无重叠。
3. **先在本分支合 main**（`git merge origin/main`），冲突在本分支内解决；main 侧代码一行不改。
4. 本分支构建通过后才准合并：`npm run build` + `npm run build:cli` 全绿。
5. 合并方式只允许 `git merge --ff-only`。**禁止在 main 上 rebase / reset / amend / 手改代码**；`--ff-only` 失败即说明 main 已前移，退回第 3 步，不许加 `--no-ff` 硬合。

冲突原则（按优先级）：

| 情况 | 做法 |
|---|---|
| main 改了我也改了的同一处 | **以 main 为准**，我的改动改名/挪位/重写适配，绝不反向覆盖 main |
| main 新增的字段/导出/方法与我重名 | 我的改名为 `xxxForLab` / `xxxV2` 之类，main 侧保持原样 |
| main 删了我依赖的东西 | 我在自己分支里补一层适配或另起实现，不恢复 main 已删内容 |
| 实在无法两全 | **停手报告用户**，不擅自改 main；把冲突破法和两个方案讲清楚，由用户裁决 |

收尾：

- 合并成功 → `git push origin main` → 校验 `git rev-parse main origin/main` 一致 → 再跑一次构建确认。
- 确认 main 已推上去之后，删除已并入的功能分支：本地 `git branch -d feat/<名>`，远端 `git push origin --delete feat/<名>`。远端只剩 `main` 与 `gh-pages` 才算收干净。
- 若 main 推送被拒（远端已被人推新提交），**不 force**；重新 fetch，回到第 3 步。
- **合并即发布，版本时间必须前进**：合并到 main 后，由 `deploy-pages.yml` 在 Actions 里重新 `pnpm build`，那里注入的 `__BUILD_TIME__` 才是线上时间，同时替换 SW 缓存名。推送后等这个 run 变绿，打开「人物」主页面，「人物」标题上方的「最新版本」时间必须与**这次 Actions 构建**的时间一致（一般比本地门禁构建晚几十秒到几分钟，两者不相等是正常的）。若仍显示旧时间，先确认部署完成，再强制刷新一次，仍不对就查 SW 缓存名。**不许手改 `src/core/buildInfo.ts` 或用常量兜住 BUILD_TIME**，那等于伪造版本号。

## 铁律五·附：版本时间的含义与责任

- 版本时间 = `vite.config.ts` 里 `__BUILD_TIME__: new Date().toISOString()` 在**构建那一刻**取的值，不构建就不会变。
- **线上时间来自 CI，不是本机**：`deploy-pages.yml` 在 push 到 main 后跑 `pnpm build` 并覆盖 `gh-pages`，所以手机上看到的是 Actions 的构建时刻；本地 `npm run build` 只用于门禁，它的时间不会出现在线上。
- 因此「合并分支」这个动作本身不产生新版本，**合并 → 推送 → Actions 构建 → 部署**走完，线上才算发布。
- 展示位置：「人物」主页面标题上方（`PersonList` 里一行居中小字「最新版本 · …」）与「设置」页底部（`最后构建：…`），两处同源。
- 用它判断线上新旧：与该次 run 的时间一致 = 浏览器拿到的是新包；不一致 = 还是旧 SW 缓存或部署没生效，不要据此判断功能没写对。

## 铁律六：写过的工具不许删，必须留下说明

用户 2026-10-23 立规：

> **工具留下，并附上说明，避免反复重写。**

过去的老毛病是「临时写个脚本 → 用完就删 → 下次需要又从头写」。从现在起：

1. **只增不删**：`scripts/`、`tools/`、`src/core/tools/` 以及与开发相关的调试脚本、生成器、迁移脚本，一律保留。
2. **每个工具都要有说明**：一句话用途、入口命令、依赖、已知限制。写在同目录 `README.md`，并在 `tools/README.md` 的索引表里加一行。
3. **被取代不删**：标 `@deprecated` 或注释「已被 X 取代，保留原因：…」，状态改成「已弃用（日期，原因，替代品）」。
4. **先查后写**：动手前先翻 `tools/README.md`，有现成的就别重写。
5. **只有三类可删**：含密钥/个人隐私的、纯构建产物（`dist/`、`dist-cli/`）、放在 `/tmp` 从未入库的临时脚本。删已入库的工具需在提交信息里写明理由，并在索引里留「已移除：X（原因）」。

索引文件：`tools/README.md`。细则见 `DEVELOPMENT.md` §1.7。

## 铁律四：每个新功能都要给 AI 留调用接口

用户明确要求过的约定：**新增能力时必须同时让 AI / CLI 能调用**。

做法（三入口共用一份实现，不分叉）：

1. 业务逻辑写在 `src/core/repo/`（或对应 core 子模块），UI 直接 import。
2. 在 `src/core/tools/<分组>.ts` 里加一条 `ToolDef`（name / title / desc / params / mutating / run），
   `run` 只做「参数收拢 + 结果裁剪」，不重写业务。
3. 在 `src/core/tools/registry.ts` 的 `TOOLS` 数组里登记（重名会在启动时抛错）。
4. 会写库的一律 `mutating: true` —— 这决定 AI / CLI 调用前会不会自动拍快照。

这样网页 UI、命令行（`docs/cli.md`）、AI 助手（`src/core/ai/agent.ts`）三条路自动同时获得新能力。
防误改靠快照：`src/core/snapshots/`，整库落盘、与库文件分开存放，AI/CLI 动手前自动拍。

## 目录结构

```
/workspace
├── CLAUDE.md                       本文件（项目约定）
├── dating-record-architecture.md   架构设计 v1（唯一真相源，先改它再写代码）
├── scripts/
│   ├── git-sync.sh                 自动提交 + 推送（钩子调用）
│   └── git-remote.sh               配置远程仓库地址
└── packages/                       代码（尚未开始，按架构文档第 8 节分层）
    ├── domain/         实体、值对象、校验（纯函数，零 IO）
    ├── schema/         AttributeDef、迁移脚本
    ├── repository/     Repository 接口 + SQLite 实现
    ├── search/         索引、查询、智能集合求值
    ├── io/             .drp 导入导出
    ├── app-core/       用例编排
    └── ui-web/         界面
```

## 铁律三：开发流程

1. **动手前先读 `DEVELOPMENT.md`**（流程规范 + 功能规格 + 路线图）。
   - **术语表在 `DEVELOPMENT.md` §0.1**：主页（人物 / 事件集 / 时间线 / 日历）、人物项、事件集项、事件项、日期框、人物详情、事件集详情、事件详情。界面文案、提交信息、文档一律照此，不自造同义词（不写「条目 / 卡片 / 列表页」）。
2. 开发顺序固定为 **数据模型 → 用例 → UI → 测试**，不可跳步。本软件复杂度几乎全在数据模型，先做 UI 必然返工。
3. 新建任何表/字段，必须过一遍 `DEVELOPMENT.md` 附录 A 的**同步埋点 Checklist**（ULID / device_id / rev / hlc / deleted_at / order_key 字符串 / oplog / 内容寻址）。
4. 完成标准（DoD）见 `DEVELOPMENT.md` §1.5，未完成不得收工。

## 关键架构约束（写代码前必读架构文档）

1. 关联关系一律用独立关联表/数组表达，**不在实体里内嵌对方完整数据**。
2. 人物属性值只存值，类型由 `AttributeDef` 决定；未知 key 按 `json` 兜底，**绝不丢弃**。
3. 属性定义**只归档不物理删除**；`key` 不可改，`type` 不可改。
4. 事件时间用 `TimeSpec` 值对象，冗余 `start_ts`/`end_ts` 供索引排序。
5. 事件集 MVP 用单父树 + 闭包表，预留多父 DAG；成员归属以关联表为唯一真相源。
6. Domain 层不 import 任何 IO 库。

## 环境备注

- git 身份：`WorkBuddy Agent <workbuddy@agent.local>`（可按需改为本人身份）
- 远程仓库：已配置 `origin → git@github.com:totooicu/DatingRecord.git`，`git-sync.sh` 会自动推送。
- **网络**：沙箱到 github.com 的 **HTTPS 与 SSH(22/443) 均可用**（2026-10-20 实测：HTTPS clone 成功、SSH 认证成功）。远程按约定走 SSH：`ssh-ed25519` 密钥在 `~/.ssh/id_ed25519_github`，`~/.ssh/config` 已指定。
- **密钥随沙箱重置丢失**：这是常态，不是故障。恢复流程：`ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_github -N ""` → 把 `.pub` 交给用户添加到 GitHub → `ssh -T git@github.com` 验证。不要把私钥贴进对话。
- **不用 PR / 不等 CI**：本仓库已摒弃 Pull Request 流程，直接本地合并（见铁律五）。`ci/pr-workflow` 分支与 `ci.yml` 已于 2026-10-23 删除，合并门槛是本地 `npm run build` + `npm run build:cli`。`.github/workflows/deploy-pages.yml` 是另一回事（main 推送后自动部署 Pages），保留。
- **GitHub Actions 状态查不了**：`gh` 未登录（也没有 token），如确需看运行结果，改用公开 API：`curl -s https://api.github.com/repos/totooicu/DatingRecord/actions/runs?per_page=5`，再取 `<run_id>/jobs` 看是哪一步失败。
- **发布到 Pages**：`bash scripts/deploy-pages.sh`（SSH 需带 `GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_github -o IdentitiesOnly=yes"`）。Pages 源是 gh-pages 分支，别用 `actions/deploy-pages`。
