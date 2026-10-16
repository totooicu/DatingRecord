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

## 铁律二：不覆盖用户数据

- `data/`、`attachments/`、`*.db` 等运行时数据已进 `.gitignore`，不入库。
- 删除操作一律软删除，附件按引用计数清理（见架构文档第 11 节）。

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

## 关键架构约束（写代码前必读架构文档）

1. 关联关系一律用独立关联表/数组表达，**不在实体里内嵌对方完整数据**。
2. 人物属性值只存值，类型由 `AttributeDef` 决定；未知 key 按 `json` 兜底，**绝不丢弃**。
3. 属性定义**只归档不物理删除**；`key` 不可改，`type` 不可改。
4. 事件时间用 `TimeSpec` 值对象，冗余 `start_ts`/`end_ts` 供索引排序。
5. 事件集 MVP 用单父树 + 闭包表，预留多父 DAG；成员归属以关联表为唯一真相源。
6. Domain 层不 import 任何 IO 库。

## 环境备注

- git 身份：`WorkBuddy Agent <workbuddy@agent.local>`（可按需改为本人身份）
- 远程仓库：尚未配置。用户提供地址后执行 `bash scripts/git-remote.sh <URL>` 即可启用自动推送。
