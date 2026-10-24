# 工具索引（scripts / tools）

**只增不删。** 用不上的工具保留在原处并标注状态，方便下次直接复用，而不是从头再写一遍。
规则见 `DEVELOPMENT.md` §1.7 与 `CLAUDE.md` 铁律六。

## scripts/

| 脚本 | 作用 | 怎么用 | 状态 |
|---|---|---|---|
| `build-cli.mjs` | 把 `src/cli` 打包成 `dist-cli/cli.cjs` | `npm run build:cli`（合并前必跑） | 在用 |
| `bust-sw.mjs` | 替换 `public/sw.js` 里的缓存名占位符，避免旧 SW 缓存住旧页面 | `npm run build` 末尾自动执行 | 在用 |
| `deploy-pages.sh` | 构建后把 `dist/` 覆盖到 `gh-pages` 分支，触发 Pages 发布 | `bash scripts/deploy-pages.sh` | 在用（常规发布走 push main 的 Actions） |
| `git-sync.sh` | 自动提交 + 推送当前分支，供 Stop/SessionEnd 钩子调用 | `bash scripts/git-sync.sh` | 在用 |
| `git-remote.sh` | 一次性配置 `origin` 远程地址 | `bash scripts/git-remote.sh` | 备用 |

## tools/

| 目录 | 作用 | 说明 |
|---|---|---|
| `nutstore-proxy/` | 坚果云 WebDAV 反向代理，绕开它不返回 CORS 头的问题 | 见该目录的 `README.md` |
| `e2e/wasm-cache-check.mjs` | 验证数据库引擎只下一次：连开三次页面，统计 `sql-wasm.wasm` 的网络响应次数 | 先 `npm run build` + `npx vite preview --port 4173`，再 `node tools/e2e/wasm-cache-check.mjs [url]`；正常结果 = 1 次。依赖全局 playwright |
| `e2e/fake-ai-flow.mjs` | 假 OpenAI 服务，喂一条「建 P1/Es1/E1 → 改 E1 → 删 E2、归档 P2 → 改 Es1 → 建 E3 → 删 E3 → 改 P3」的操作流 | `node tools/e2e/fake-ai-flow.mjs`（PORT 可改）。配合下面的 e2e 脚本，不需要真密钥 |
| `e2e/snap-flow-e2e.mjs` | 端到端跑上面那条操作流：暂存态核对 新增/修改/删除 分组 → 点「执行这轮改动」→ 落地后拒绝修改组单项（该项从分组消失）→ 点开新增组对象跳真实详情页 → 按返回键原路回成果 → 事件跳转后点设置仍能回成果 | 需要 dev/preview 服务 + 上面的假服务：`FAKE=http://localhost:8791/v1 node tools/e2e/snap-flow-e2e.mjs [url]`。控制台的 error/warning 会连同源码位置一起打印 |
| `e2e/input-review-e2e.mjs` | 验证两项：① AI 对话框 Enter 只换行不发送、Ctrl+Enter 才发送；② 「审核后执行」——AI 跑完改动先挂起，点「执行」前真实人物列表看不到新建的 P1、点「执行」后才看得到 | 需要 preview 服务 + 假服务：`FAKE=http://localhost:8791/v1 node tools/e2e/input-review-e2e.mjs http://localhost:4173/`。依赖全局 playwright |
| `e2e/fake-ai-matrix.mjs` | 多变种假 OpenAI 服务：按用户消息关键词走不同操作流——纯新增 / 纯修改 / 纯删除 / 建了又删（净零）/ 混合 / 无改动（不调写工具） | `PORT=8794 node tools/e2e/fake-ai-matrix.mjs`。配合下面的矩阵 e2e |
| `e2e/review-matrix-e2e.mjs` | 12 个场景 × 三时间点核对（AI 动手前 → 暂存待执行 → 点执行后）：新增/修改/删除/净零各自落地行为；pending 时真实库必须还是原样、执行后才变；撤销放不回未落地改动也撤不掉已执行成果；放弃/刷新保持/多 pending 拦截；已执行后「放弃改动」整轮回退且列表保留 auto 留底；暂存期间合并导入后执行被拦截（stale 守卫）、放弃后外部改动完好 | 需要 preview 服务 + 矩阵假服务：`FAKE=http://localhost:8794/v1 node tools/e2e/review-matrix-e2e.mjs http://localhost:4173/`。结尾汇总通过/失败数，失败时 exit 1 |

## src/core/tools/

AI / CLI / UI 三入口共用的工具注册表（`registry.ts` + `<分组>.ts`）。新增能力时按 `CLAUDE.md` 铁律四在这里登记，不要另起一套。

## 新增一个工具时

1. 放进 `scripts/`（构建/发布/仓库操作）或 `tools/<名字>/`（独立程序、带依赖）。
2. 同目录写 `README.md`：一句话用途、入口命令、依赖、已知限制。
3. 在上面的表格里加一行，状态写「在用」。
4. 如果是 `src/core/tools/` 里的业务工具，按铁律四登记到 `TOOLS` 数组，并设 `mutating` 标记。

## 废弃一个工具时

把状态改成「已弃用（YYYY-MM-DD，原因，替代品 X）」，代码保留。删文件只允许三种情况：含密钥/隐私、纯构建产物、从未入库的临时脚本。
