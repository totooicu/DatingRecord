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

## src/core/tools/

AI / CLI / UI 三入口共用的工具注册表（`registry.ts` + `<分组>.ts`）。新增能力时按 `CLAUDE.md` 铁律四在这里登记，不要另起一套。

## 新增一个工具时

1. 放进 `scripts/`（构建/发布/仓库操作）或 `tools/<名字>/`（独立程序、带依赖）。
2. 同目录写 `README.md`：一句话用途、入口命令、依赖、已知限制。
3. 在上面的表格里加一行，状态写「在用」。
4. 如果是 `src/core/tools/` 里的业务工具，按铁律四登记到 `TOOLS` 数组，并设 `mutating` 标记。

## 废弃一个工具时

把状态改成「已弃用（YYYY-MM-DD，原因，替代品 X）」，代码保留。删文件只允许三种情况：含密钥/隐私、纯构建产物、从未入库的临时脚本。
