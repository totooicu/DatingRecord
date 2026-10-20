# 约会记录 · Dating Record

本地优先的个人关系档案工具。三层模型：**人物（动态属性）/ 事件集（可嵌套）/ 事件**。

数据全部存在你自己的浏览器里（SQLite WASM + IndexedDB），**支持随时导出为单文件 JSON 备份**。

## 快速开始

```bash
pnpm install
pnpm dev        # 开发模式（默认 http://localhost:5173）
pnpm build      # 类型检查 + 生产构建（输出 dist/）
pnpm preview    # 预览构建产物
```

> 首次打开点击「载入示例数据看看效果」即可看到完整界面。

## 功能（v0.1 试水版）

| 模块 | 已实现 |
|---|---|
| 人物 | 创建、改名、标签、归档；**属性动态增减**（9 种控件类型 + 属性字典自建字段）；统计（事件数 / 最近见面 / 总花费 / 平均评分） |
| 事件 | 创建/编辑/软删除/回收站；**六种时间模型**（时刻 / 区间 / 模糊 / 进行中 / 未知）；参与者、地点、评分、花费、心情、亲密度、标签、正文；多集合归属 |
| 事件集 | 无限嵌套（闭包表）、移动（含环检测）、成员增删、上下移动排序、面包屑、子集合 |
| 时间线 | 按月分组、关键词搜索、多条件筛选（人物/集合/类型/评分/时间范围/标签） |
| **备份** | **导出 `.drp.json`（可含附件）**、**合并导入（按 hlc 比较，本地更新不被覆盖）**、**替换导入（自动先备份）** |
| 数据层 | ULID、HLC 混合逻辑时钟、软删除墓碑、oplog 操作日志、fractional index 排序 —— 为将来跨端同步埋好点 |

## 目录结构

```
src/
├── core/                 纯逻辑层（不依赖 React）
│   ├── db.ts             sql.js + IndexedDB 持久化、建表、迁移、事务、oplog
│   ├── types.ts          领域类型
│   ├── id.ts             ULID
│   ├── time.ts           TimeSpec 时间模型 + HLC
│   ├── order.ts          fractional index 排序键
│   ├── io.ts             导入导出 + 行/对象映射
│   ├── seed.ts           示例数据
│   └── repo/             persons / events / collections 三个仓储
├── ui/                   React 界面
└── store.ts              写操作后的版本号广播（各组件自动重查）
```

## 数据备份说明

- 导出文件名：`dating-record-YYYYMMDDHHmm.drp.json`
- 内容：`schemaVersion` + 属性字典 + 人物 + 事件（含参与者）+ 事件集（含嵌套关系）+ 成员 + 附件
- 纯文本、可 diff，可以放进 git 做版本管理
- 导入合并逻辑：同 ID 时比较 `hlc`，本地更新则跳过（不会用旧备份覆盖新数据）

## 文档

- `dating-record-architecture.md` — 架构设计（数据模型、分层、存储）
- `dating-record-ai-capabilities.md` — AI 能力规划
- `dating-record-storage-sync.md` — 跨端与同步设计
- `DEVELOPMENT.md` — 开发手册（流程规范、功能规格、路线图）
- `CLAUDE.md` — 项目约定

## 已知限制（试水版）

- 单端单浏览器，暂无同步（数据模型已埋点，见 `dating-record-storage-sync.md`）
- 附件目前未做上传 UI（表与导出已就绪）
- 无应用锁 / 加密（v1 计划）
- 智能集合、属性历史曲线、统计图表为 v1 范围
