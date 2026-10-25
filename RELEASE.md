# 发布手册

> 对应版本：网页 v1.0.1 ↔ 壳 v1.0.1（桥协议 proto 1）
> 壳侧随附手册：`geckoview_example/docs/RELEASE_GUIDE.md`

这份手册管一件事：**让「线上的页面」和「手机上的壳」对得上号，并且能复现**。
发布不是一个 `git push`，而是三个数字对齐、两处产物落地、一次自检。

---

## 一、三个数字

| 数字 | 在哪 | 谁改 | 改坏了会怎样 |
|---|---|---|---|
| 网页版本 | `package.json` 的 `version`；构建时注入页面（`__APP_VERSION__`）与 `version.json` 的 `release` | 网页侧发版 | 页面自报的版本和包里不是一回事，配对结论失真 |
| 壳版本 | 壳 `app/build.gradle` 的 `versionName`；写进 UA（`DatingRecord/x.y.z`）与 `getEnv().version` | 壳侧发版 | 同上 |
| 桥协议 | 网页 `src/core/compat/pairing.ts` 的 `BRIDGE_PROTO`；壳 `JsBridge.getEnv()` 的 `proto` | 改桥契约时同步升 | 页面在原生能力上静默失败 |

版本号只说明「哪一次构建」，**能不能配由 `proto` 决定**。三者在「设置 → 功能体验 →
软件适配测试 → 版本配对」里并排显示，配不上会直接说该升网页还是该换壳。

---

## 二、线上地址：最新 vs 快照

| 地址 | 内容 | 谁在用 | 会自己变吗 |
|---|---|---|---|
| `/DatingRecord/` | 跟着 `main` 走的最新构建 | 浏览器、自己日常看 | 会，每次推 main 就变 |
| `/DatingRecord/releases/v1/` | v1 冻结快照 | **壳**（`DEFAULT_URL`） | 不会，只有打 `v1.x` tag 才重写 |

- 根路径是「测试版」性质，它就是用来随时看最新的；**壳绝对不能指向它**，否则装到手机上的
  壳会跟着网页悄悄变版本，出了问题无法复现。
- 快照按大版本分目录：`v1.0.1`、`v1.1.0` 都写进 `releases/v1/`；`v2` 另开 `releases/v2/`。
  同一大版本内滚动更新，是因为壳的 `DEFAULT_URL` 只能指一个固定目录。
- 快照由 `.github/workflows/release-v1-pages.yml` 生成：**只在 tag（`v1.*`）或手动触发时跑**。
- 日常部署（`deploy-pages.yml`）清目录时必须保留 `releases/`——不保留，一次普通部署就把
  已发布版本删了。

---

## 三、版本号规则

- **网页与壳同号发布**：`1.0.1` 的网页配 `1.0.1` 的壳，看一眼就知道谁配谁。
- **壳的 `versionCode` 只增**：1.0.0=3、1.0.1=4……每次发版 +1，装不上/装成旧版多半是这个没加。
- **升 `proto` 的时机**：只在新桥能力**增**的时候不用动；删 action、改参数语义必须升，
  且与壳的大版本一起发（网页 v2 的页面配壳 v2）。
- **`SHELL_MIN`**：网页要求的最低壳版本，与 `version.json` 的 `shellMin` 一起升。
  老壳打开新页面时，适配测试里会显示「壳太旧」，而不是让人对着点不动的按钮猜。

### 桥的兼容纪律

1. **只增不删**：给 `JsBridge.dispatch()` 加新 action 是安全改动（老壳没有，页面探测不到就降级）；
   删 action、改参数语义一律不兼容，必须升 `proto` 并同步壳的大版本。
2. **页面不假定壳有**：调桥前先探测（`window.AndroidBridge` / `ping`），缺了就提示，不静默失败。
3. **壳不猜页面版本**：壳只报自己的版本与 `proto`，配不配由页面判断。
4. **改桥两边同版本上线**：不允许单边发——页面调一个壳里没有的 action，等于功能静默死亡。

---

## 四、发布前检查

1. **功能冻结**：这一版要发的东西已经合进 `main`，没有半截功能在分支上等着。
2. **门禁通过**：`pnpm build` + `pnpm build:cli` 两条都绿（`build` 里含 `tsc --noEmit`）。
3. **数据兼容**：涉及存储结构/导入导出的改动，确认老数据能读（本地库、`.drp.zip`、CLI 的 sqlite）。
4. **桥的改动**：动了 `JsBridge` 相关调用，先确认壳侧同一版本已经/同时发布，否则页面会调一个
   壳里没有的 action。
5. **版本号已改**：`package.json` 的 `version` 是本版，`RELEASE.md` 的发布记录先不写（等自检过）。

---

## 五、发布步骤

**网页侧**

```bash
git fetch origin && git switch -c feat/release-<版本> origin/main   # 铁律五：先建分支
# 改 package.json 的 version，必要时改 SHELL_MIN / BRIDGE_PROTO
pnpm build && pnpm build:cli                                       # 门禁
git merge origin/main                                              # 冲突在分支内解决
git switch main && git merge --ff-only feat/release-<版本>
git push origin main                                               # 触发 deploy-pages.yml（根路径）
git tag -a v<版本> -m "网页 v<版本>（配壳 v<版本>，proto N）" && git push origin v<版本>
# 推 tag 会自动触发 release-v1-pages.yml：写快照 + 自检线上 version.json
git branch -d feat/release-<版本> && git push origin --delete feat/release-<版本>
```

**壳侧**（详见壳仓库 `docs/RELEASE_GUIDE.md`）

```bash
./gradlew :app:assembleRelease --no-daemon   # 唯一门禁
# versionName 与网页同号，versionCode +1，DEFAULT_URL 指 releases/v1/
# 合并 → 打 tag v<版本> → 分发 APK（附 SHA-256）
```

**收尾**：在本文「发布记录」加一行（网页版本 / 壳版本 / proto / 说明），
并在壳仓库手册的镜像表里同步一行。

---

## 六、发布后自检（缺一不可）

| 检查 | 命令/位置 | 期望 |
|---|---|---|
| 根路径已更新 | `curl -s https://totooicu.github.io/DatingRecord/version.json` | `release` 是新版本 |
| 快照已更新 | 同上，路径换成 `/releases/v1/version.json` | `release` 是新版本，`proto` 正确 |
| 快照真的能跑 | 浏览器打开 `/releases/v1/` | 页面正常、无 404 白屏 |
| 页面新代码在线上 | 打开页面，看「最新版本」时间 = 这次 Actions 的构建时间 | 一致（差几分钟正常） |
| 配对正确 | 手机上壳内 → 适配测试 → 版本配对 | 网页/壳版本一致、proto 一致、配对正常 |
| 壳加载的是快照 | 同上「壳版本」与 UA | UA 里是 `DatingRecord/<新版本>` |

前四项能在电脑上做，最后两项必须装到手机上看。

---

## 七、回滚

- **线上页面出错**：`git revert <提交> && git push origin main` → 根路径自动回到上一版；
  若错误已经进了快照，把 tag 指向回退后的提交重新触发
  （`git tag -f v<版本> <提交> && git push -f origin v<版本>`），快照随之回到可用状态。
- **只想让壳回旧页**：壳加载的是固定目录，最快的办法是重新发一次快照（tag 重打）——
  壳不用重装，下次打开就换回来了。
- **壳本身有问题**：把上一个版本的 APK 重新分发（安装包只增不覆盖，旧包永远在）。
  **不许改签名**——换钥匙等于换 App，升级装不上、卸载还会清掉本地数据。
- **回滚也是发布**：回滚后同样要跑第六节自检，并在发布记录里补一行「回滚」说明。

---

## 八、常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| 根路径还是旧版本 | Actions 没跑完 / Pages 还没重建 | 等 `pages build and deployment` 变绿，再强制刷新 |
| 快照 404 | tag 没触发 release 流程，或 workflow 失败 | 看 Actions 里 `Release v1 snapshot` 的日志；必要时手动 dispatch |
| 快照被日常部署删了 | `deploy-pages.yml` 的清理没保留 `releases/` | 恢复该行，重跑一次发布 |
| 页面白屏、控制台 404 | 子目录部署时用了绝对路径 | 保持 `base: './'`、SW 与 `version.json` 全用相对路径 |
| 打开还是旧页面 | Service Worker 缓存 | 换新版本号触发全量更新；别手改 SW 缓存名绕过 |
| 适配测试显示「壳太旧」 | 壳版本低于 `SHELL_MIN` | 发新壳或用回配套的旧网页 |
| 适配测试显示「协议不一致」 | 网页与壳的 `proto` 不同 | 换配套的一方，别硬凑 |
| 壳里页面正常但原生全失效 | 桥没注入（域名锁/加载失败） | 看 UA 有没有 `DatingRecord/`、`data-gv-bridge-injected` 是否为 true |

---

## 九、发布记录

| 日期 | 网页 | 壳 | proto | 说明 |
|---|---|---|---|---|
| 2026-10-25 | v1.0.1 | v1.0.1 | 1 | 壳改为加载冻结快照 `releases/v1/`；新增 release action；麦克风标注为实验能力 |
| 2026-10-25 | v1.0.0 | v1.0.0 | 1 | 第一个正式版（壳指向根路径，属浮动版，已被 v1.0.1 取代） |

发新版就在表里加一行，**别改历史行**——这张表是「谁的手机该配哪个网页」的唯一答案。
