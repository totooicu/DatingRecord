# 发布与版本配对

> 对应版本：网页 v1.0.1 ↔ 壳 v1.0.1（桥协议 proto 1）

网页是「随时上线」的，壳是「发出去就收不回来」的。所以发布的第一件事不是打 tag，
而是把三个数字对齐：

| 数字 | 在哪 | 谁改 |
|---|---|---|
| 网页版本 | `package.json` 的 `version`，构建时注入页面与 `version.json` 的 `release` | 网页侧发版时 |
| 壳版本 | 壳 `app/build.gradle` 的 `versionName`，写进 UA（`DatingRecord/x.y.z`）和 `getEnv().version` | 壳侧发版时 |
| 桥协议 | 网页 `src/core/compat/pairing.ts` 的 `BRIDGE_PROTO`，壳 `JsBridge.getEnv()` 的 `proto` | 改桥契约时同步升 |

版本号本身不决定能不能配，`proto` 才决定。页面上的「设置 → 功能体验 → 软件适配测试 →
版本配对」把三个数摆在一起，配不上会直接说清楚是该升网页还是该换壳。

## 发布记录

| 日期 | 网页 | 壳 | proto | 说明 |
|---|---|---|---|---|
| 2026-10-25 | v1.0.1 | v1.0.1 | 1 | 壳改为加载冻结快照 `releases/v1/`；新增 release action；麦克风标注为实验能力 |
| 2026-10-25 | v1.0.0 | v1.0.0 | 1 | 第一个正式版（壳指向根路径，属浮动版，已被 v1.0.1 取代） |

发新版就在表里加一行，别改历史行——这张表是「谁的手机该配哪个网页」的唯一答案。

## 线上地址：哪个是「最新」，哪个是「v1」

| 地址 | 内容 | 谁在用 |
|---|---|---|
| `https://totooicu.github.io/DatingRecord/` | 跟着 `main` 走的最新构建，一次推送就变 | 浏览器、自己日常看 |
| `https://totooicu.github.io/DatingRecord/releases/v1/` | v1 的冻结快照，只有打 `v1.x` tag 才会重写 | **壳**（`DEFAULT_URL` 指这里） |

根路径是「测试版」没毛病，它就是用来随时看最新的；壳必须指向快照，否则等于没锁版本。
快照由 `.github/workflows/release-v1-pages.yml` 生成：只在 tag（`v1.*`）或手动触发时跑，
把该 tag 的 `dist` 写进 gh-pages 的 `releases/v1/`，**不动**根路径的产物。
反过来，日常的 `deploy-pages.yml` 清目录时必须保留 `releases/`，否则一次普通部署就把已发布版本删了。

快照按大版本分目录，v1.0.1、v1.1.0 都进 `releases/v1/`（壳会跟着升级）；
v2 另开 `releases/v2/`，与 v1 的页面互不影响。

## 兼容纪律

1. **桥只增不删**：给 `JsBridge.dispatch()` 加新 action 是安全改动（老壳没有，页面探测不到就降级）；
   改参数语义、删 action 一律视为不兼容，必须同时升 `proto` 与壳的大版本。
2. **网页不做「假定壳有」的调用**：桥能力一律先探测（`window.AndroidBridge` / `ping`），
   缺了就提示，不静默失败。
3. **壳不猜页面版本**：壳只报自己的版本与 `proto`，判断配不配是页面的事。
4. **最低壳版本**：网页的 `SHELL_MIN` 与 `version.json` 的 `shellMin` 一起升，老壳打开新页面时
   适配测试里会显示「壳太旧」，而不是让人对着一个点不动按钮猜。

## 一次发布的步骤

**网页侧**

1. 确认功能冻结，把 `package.json` 的 `version` 改成本次版本（本文件「发布记录」同步加行）；
2. 分支上改 → `pnpm build` + `pnpm build:cli` 两道门禁 → 合 `origin/main` → `--ff-only` 合入 main 推上去；
3. 等 Actions 部署完，验证根路径 `version.json` 的 `release` 与 `proto` 是新值；
4. `git tag v1.0.1 && git push origin v1.0.1` —— 推 tag 会自动触发
   `release-v1-pages.yml`，把这一版写进 `releases/v1/` 并自检线上 `version.json`；
5. 验证 `releases/v1/version.json` 的 `release` 与新版本一致、且再推一次 main 后它不变。

**壳侧**

1. `versionName` 改成与网页同一版本号，`versionCode` 只增不减（发版前先确认）；
2. 门禁：`./gradlew :app:assembleRelease --no-daemon` 通过；
3. 分支 → 合 origin/main → `--ff-only` 并入 main → 推送 → `git tag v1.0.0 && git push origin v1.0.0`；
4. APK 记为 `zhaohuixisi-<版本>.apk`，算出 SHA-256 一并发出，安装包只增不覆盖。
5. 壳的 `DEFAULT_URL` 从 v1.0.1 起固定为 `https://totooicu.github.io/DatingRecord/releases/v1/`。

## 发布前必须定死、之后改不了的

1. **签名密钥**：换钥匙等于换 App——版本更新会被系统拒绝，只能卸载重装，而卸载会清掉
   WebView 里的本地数据。v1.0.0 起固定使用同一把钥匙，密钥文件与口令由你保管，不进库。
2. **applicationId**：`org.mozilla.geckoview_example`（沿用现有已安装的包，v1.0.0 起冻结）。
3. **versionCode**：v1.0.0 = 3，之后每次发布 +1。

## 已知边界

- 麦克风：壳已具备完整权限链路（`RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS` + `onPermissionRequest` 放行），
  但部分机型上系统只给静音数据（OnePlus PLC110 / Android 16 实测原生录音峰值为 0）。
  该能力按「实验」对待，不进 v1.0.0 的验收项，结案后再谈语音相关功能。
- 库里还有 `v1.0.0` 的旧壳（指向根路径），它是浮动的：网页一部署它就跟着变，
  所以 v1.0.1 出包后应尽快覆盖安装，别让两份壳长期并存。
- 冻结快照只保护「页面不会自己变」，不保护「老壳缺新能力」——后者仍靠 `proto` 与 `SHELL_MIN` 判定。
