# ai-sandbox · 模拟 AI 操作的沙盒实验

分支：`research/ai-sandbox`（从 `cf94e77` 拉出）。
目的：假设 AI 会改动**任何**内容，做一个能把这类指令接住、校验、预览、执行、回退的沙盒；
因为后面要在这上面继续开发，所以判定逻辑全部沉到 `core.mjs`，界面只是它的一层皮。

## 文件

| 文件 | 说明 |
| --- | --- |
| `core.mjs` | 内核（994 行，零依赖，不碰 DOM）。state / op / changeset / journal 四件套 |
| `selfcheck.mjs` | 内核自检，269 条断言，覆盖保护区、原型污染、非声明式、悬挂引用、限额、前值冲突、令牌确定性、env 漂移、原子/宽松、副作用补偿、回退链双轨自检 |
| `lab-app.js` | 实验台 UI 源码：示例世界 + 22 条指令池（正常 / 危险 / 越权 / 注入 / 超大 / 过期 / 不可逆）+ 打包·预览·执行·回退·放弃 |
| `build-lab.mjs` | 把内核 + UI 内联成单文件 `lab.html`（`file://` 下 ES Module 会被 CORS 拦，所以必须内联） |
| `lab.html` | 生成产物，手机上双击即可玩 |
| `lab-e2e.mjs` | Playwright 浏览器回归，56 条断言，靠 `<body data-*>` 诊断属性核对 |
| `接入手册.md` | **给后续开发者的主文档**：指令协议、schema、策略、生命周期、回退与补偿、问题码总表、接入清单、坑清单、API 速查 |

## 跑起来

```bash
node ai-sandbox/selfcheck.mjs     # 期望最后一行：沙盒内核自检全绿。
node ai-sandbox/build-lab.mjs     # 生成 ai-sandbox/lab.html
node ai-sandbox/lab-e2e.mjs       # 需要 Playwright；可用 PLAYWRIGHT / CHROME 环境变量覆盖路径
```

## 一分钟理解内核

```
begin → dispatch(op)* → dryRun → commit | discard      一批指令 = 一个 changeset
commit / revert 只追加 journal，永不删除                 版本流水
```

指令只有八种声明式 kind（`set / delete / insert / reorder / rename / create / effect / bulk`），
其余形态（脚本、SQL、HTML、函数值、`__proto__` 键、保护区路径、超限额、悬挂引用、前值不匹配、两次算不一样）
全部在预览阶段被拦下，并带上 `code / msg / fix` 三件套 —— `fix` 就是回喂给 AI 的下一轮提示词。

## 与主项目的关系

目前**完全独立**：不在 `src/`、不在 `public/`，`pnpm run build` 不受影响。
真要接进 DatingRecord，照《接入手册.md》§9 的清单走（世界建模、schema、副作用登记、sink 消费、UI 三件套、持久化）。
