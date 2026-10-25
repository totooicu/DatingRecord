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
| `remote-relay/` | 跨设备操作中继：托管页面 + WebSocket 转发（客户端 ↔ 服务端），按 token 分房间；不需要中继时可用页面里的「直连（WebRTC）」 | `npm run relay -- --port 4173 --token xxx`；见该目录 `README.md` |
| `e2e/input-review-e2e.mjs` | 验证两项：① AI 对话框 Enter 只换行不发送、Ctrl+Enter 才发送；② 「审核后执行」——AI 跑完改动先挂起，点「执行」前真实人物列表看不到新建的 P1、点「执行」后才看得到 | 需要 preview 服务 + 假服务：`FAKE=http://localhost:8791/v1 node tools/e2e/input-review-e2e.mjs http://localhost:4173/`。依赖全局 playwright |
| `e2e/fake-ai-matrix.mjs` | 多变种假 OpenAI 服务：按用户消息关键词走不同操作流——纯新增 / 纯修改 / 纯删除 / 建了又删（净零）/ 混合 / 无改动（不调写工具）/ 「慢慢」慢响应（每回合拖 1.2s，用来测离开页面任务仍在跑）/ 「失败」直接回 500（测任务图标变红） | `PORT=8794 node tools/e2e/fake-ai-matrix.mjs`。配合下面的矩阵 e2e |
| `e2e/review-matrix-e2e.mjs` | 12 个场景 × 三时间点核对（AI 动手前 → 暂存待执行 → 点执行后）：新增/修改/删除/净零各自落地行为；pending 时真实库必须还是原样、执行后才变；撤销放不回未落地改动也撤不掉已执行成果；放弃/刷新保持/多 pending 拦截；已执行后「放弃改动」整轮回退且列表保留 auto 留底；暂存期间合并导入后执行被拦截（stale 守卫）、放弃后外部改动完好 | 需要 preview 服务 + 矩阵假服务：`FAKE=http://localhost:8794/v1 node tools/e2e/review-matrix-e2e.mjs http://localhost:4173/`。结尾汇总通过/失败数，失败时 exit 1 |
| `e2e/runtime-e2e.mjs` | 「服务 / 任务」两层体系回归（R1–R9）：AI 回复中离开聊天页不中断、head 出图标、完成变绿/失败变红、点图标跳来源页并清通知（进行中只跳不清）、主动打开来源页也清通知；服务/任务入口页可达；音乐自启动开启并刷新后 head 出服务图标、点图标跳音乐页；默认不开自启动；任务页列出/跳转/手动清除；面板播放/暂停直接驱动服务图标（播 → 出、停 → 消） | 需要 preview 服务 + 矩阵假服务：`FAKE=http://localhost:8794/v1 node tools/e2e/runtime-e2e.mjs http://localhost:4173/`。结尾汇总通过/失败数，失败时 exit 1 |
| `e2e/location-feature-e2e.mjs` | 定位功能「详细测试」全栈回归（流程1/2/3 共 50 断言）：文件选择（默认名/自定义名/无文件门控）；手动打点（带备注/选中高亮/我的位置不写点）；备注含逗号引号不崩；坐标系纠偏；阈值去重（0/5/超大/负）；**自动打点服务**（head 图标是定位图示而非音乐音符、离开面板照跑、点图标跳回、运行中改阈值即时生效、停止图标消失、刷新不恢复）；**定位服务支持自启动**（服务页出现勾选框、开自启动后刷新自动恢复）；无权限时手动失败+自动服务不中断 | 需要 preview 服务：`node tools/e2e/location-feature-e2e.mjs http://localhost:4173/`。定位权限用 Playwright context 级 mock；无权限场景用 init script 强制定位失败 |
| `e2e/location-service-e2e.mjs` | 定位「自动打点」后台服务回归（L1–L5）：开机即注册未运行服务；开始打点 head 出图标；**离开面板服务照跑**（图标在、行数继续涨——单例化后才成立）；服务页显示运行中、点「打开」回面板；停止后图标消失 | 需要 preview 服务：`node tools/e2e/location-service-e2e.mjs http://localhost:4173/`。定位权限用 Playwright context 级 mock，不需要真 GPS |
| `e2e/music-migrate-e2e.mjs` | 自启动存档迁移回归（M1–M3）：旧版 `music-autostart` key 的老用户，升级后刷新应兑现自启动（head 出图标）、搬进统一存档 `dr.svc.autostart`、旧 key 清除 | 需要 preview 服务：`node tools/e2e/music-migrate-e2e.mjs http://localhost:4173/`。会往页面传一首 `/tmp/tone.wav` |
| `e2e/music-playlist-e2e.mjs` | 歌单 `.drpl` 回归（P1–P7）：上传音频后新建歌单并带上队列、文件库按「歌单」筛选与预览、刷新恢复选中态、改名/描述、增删/排序写回文件、导入 `.drpl` 按 storedId/文件名对上曲目、删除当前歌单后曲目退回临时队列 | 需要 preview 服务：`node tools/e2e/music-playlist-e2e.mjs http://localhost:4173/`。自动生成 wav 与 `.drpl`，依赖全局 playwright（缺浏览器时退回 `/usr/bin/chromium`） |
| `e2e/location-format-tabs-e2e.mjs` | 定位 `.drloc` 与分段页回归（D1–D9 + D5b–D5e）：地图/记录/文件/说明四段切换、新建、导入带偏移的 `.drloc`、地图 8px 蓝/黄/红点、空文件不允许米制换算、按米改偏移并写回（原始点不变）、度数 / 目标两种填法（目标留空归零）、文件库按「定位」筛选与预览、旧 CSV 导入转 `.drloc`、逐点删除、点很多时只渲染最近 300 条并可展开 | 需要 preview 服务：`node tools/e2e/location-format-tabs-e2e.mjs http://localhost:4173/`。自动生成 `.drloc` 与 CSV，定位用 Playwright context mock；依赖全局 playwright（缺浏览器时退回 `/usr/bin/chromium`） |
| `e2e/settings-calendar-ui-e2e.mjs` | 设置入口与日历配色回归（S1–S2、C1）：功能体验 / 功能面板目录入口都有图标，功能面板两条子页与功能体验三条子页的图标渲染一致（防止 panel 一族漏配成空方块）；日历事件条底色按事件集分色，不再全部是写死的粉色 | 需要 preview 服务：`node tools/e2e/settings-calendar-ui-e2e.mjs http://localhost:4173/`。依赖全局 playwright（缺浏览器时退回 `/usr/bin/chromium`） |
| `e2e/color-picker-e2e.mjs` | 统一取色面板回归（C1–C6）：外观自定义里彩虹在左 / 历史在右、HEX 输入生效、RGB 输入生效、彩虹拖动取色、历史颜色刷新后仍在、事件集图标自定义背景色保存生效并进入历史 | 需要 preview 服务：`node tools/e2e/color-picker-e2e.mjs http://localhost:4173/`。截图默认写到临时目录，可用 `SHOTS=/path` 指定；依赖全局 playwright（缺浏览器时退回 `/usr/bin/chromium`） |
| `e2e/compat-test-e2e.mjs` | 软件适配测试页回归（K1–K7）：功能体验入口与 10 张测试卡、引擎信息自动填、应用依赖自检（WebAssembly / IndexedDB / Blob 必须 ✓）、浏览器里原生桥判未注入、离开再回来汇总仍在、功能面板不含高精度定位；K7 用 `addInitScript` 装假壳跑通「注入标记 → 请求 → 响应 → 事件」（扫描出设备、连接后出 GATT、私有文件写入回显路径）；K8/K9 覆盖麦克风失败路径（每档约束结果 + 设备/权限 + 怎么办）与成功路径（另起一个带 `--use-fake-device-for-media-stream` 的浏览器，授权成功、音量条出现） | 需要 preview 服务：`node tools/e2e/compat-test-e2e.mjs http://localhost:4173/`。截图写到 `/tmp/compat-shots/`；依赖全局 playwright（缺浏览器时退回 `/usr/bin/chromium`） |
| `e2e/build-time-refresh-e2e.mjs` | 人物主页「最新版本 · …」双击刷新回归（R1–R4）：构建时间与 title 里的双击提示都在；单击不刷新（计数 `framenavigated` 为 0）；双击真的重新加载（文档级标记被清、boot 重走一遍）；刷新后仍停在人物主页 | 需要 preview 服务：`node tools/e2e/build-time-refresh-e2e.mjs http://localhost:4173/`。依赖全局 playwright（缺浏览器时退回 `/usr/bin/chromium`） |

## src/core/tools/

AI / CLI / UI 三入口共用的工具注册表（`registry.ts` + `<分组>.ts`）。新增能力时按 `CLAUDE.md` 铁律四在这里登记，不要另起一套。

## 新增一个工具时

1. 放进 `scripts/`（构建/发布/仓库操作）或 `tools/<名字>/`（独立程序、带依赖）。
2. 同目录写 `README.md`：一句话用途、入口命令、依赖、已知限制。
3. 在上面的表格里加一行，状态写「在用」。
4. 如果是 `src/core/tools/` 里的业务工具，按铁律四登记到 `TOOLS` 数组，并设 `mutating` 标记。

## 废弃一个工具时

把状态改成「已弃用（YYYY-MM-DD，原因，替代品 X）」，代码保留。删文件只允许三种情况：含密钥/隐私、纯构建产物、从未入库的临时脚本。
