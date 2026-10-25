# 发布与版本配对

> 对应版本：网页 v1.0.0 ↔ 壳 v1.0.0（桥协议 proto 1）

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
| 2026-10-25 | v1.0.0 | v1.0.0 | 1 | 第一个正式版：记录/时间线/日历/设置/定位/返回键；麦克风标注为实验能力 |

发新版就在表里加一行，别改历史行——这张表是「谁的手机该配哪个网页」的唯一答案。

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
3. 等 Actions 部署完，验证线上 `version.json` 的 `release` 与 `proto` 是新值、页面 bundle 里有新字符串；
4. `git tag v1.0.0 && git push origin v1.0.0`。

**壳侧**

1. `versionName` 改成与网页同一版本号，`versionCode` 只增不减（发版前先确认）；
2. 门禁：`./gradlew :app:assembleRelease --no-daemon` 通过；
3. 分支 → 合 origin/main → `--ff-only` 并入 main → 推送 → `git tag v1.0.0 && git push origin v1.0.0`；
4. APK 记为 `zhaohuixisi-<版本>.apk`，算出 SHA-256 一并发出，安装包只增不覆盖。

## 发布前必须定死、之后改不了的

1. **签名密钥**：换钥匙等于换 App——版本更新会被系统拒绝，只能卸载重装，而卸载会清掉
   WebView 里的本地数据。v1.0.0 起固定使用同一把钥匙，密钥文件与口令由你保管，不进库。
2. **applicationId**：`org.mozilla.geckoview_example`（沿用现有已安装的包，v1.0.0 起冻结）。
3. **versionCode**：v1.0.0 = 3，之后每次发布 +1。

## 已知边界

- 麦克风：壳已具备完整权限链路（`RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS` + `onPermissionRequest` 放行），
  但部分机型上系统只给静音数据（OnePlus PLC110 / Android 16 实测原生录音峰值为 0）。
  该能力按「实验」对待，不进 v1.0.0 的验收项，结案后再谈语音相关功能。
- 网页目前是「浮动」的：壳只认域名，网页一部署所有壳立刻吃新版本。因为 `proto` 与
  `SHELL_MIN` 会把不配套的组合顶出来，暂时不必给每个壳冻一份网页；等真需要给老壳留旧页面时，
  再把 `dist` 同时拷一份到 `releases/v1/`，壳的 `DEFAULT_URL` 指过去即可。
