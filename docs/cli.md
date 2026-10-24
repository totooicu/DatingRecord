# DatingRecord CLI

命令行版的 DatingRecord——和网页版是**同一个应用的两副面孔**：UI 给人点，CLI 给人和 AI 调。
两条路最终都落到 `src/core/tools` 注册表里的同一个函数，不存在第二套实现。

## 快速开始

```bash
# 1. 构建（在项目根目录，一次性）
npm run build:cli          # 产出 dist-cli/cli.cjs

# 2. 直接用
npm run dr -- tools                        # 列出全部工具
npm run dr -- person.list --keyword 张三
# 或者绕过 npm，直接跑
node dist-cli/cli.cjs tools
```

> `dist-cli/` 已列入 .gitignore（构建产物）。克隆仓库后先 `npm install && npm run build:cli`。
> `dist-cli/cli.cjs` 运行时要从 `node_modules` 里取 `sql.js`，所以**必须在本项目目录结构内运行**，
> 单独拷走那个文件是跑不起来的。

## 数据库在哪

CLI 操作的是一个普通的 SQLite 文件：

| 位置 | 内容 |
| --- | --- |
| `./dating-record.sqlite` | 主库（默认位置） |
| `./dating-record.sqlite.snapshots/` | 整库快照，一个文件一份 |
| `./dating-record.sqlite.blobs/` | 附件二进制（图片等） |

换位置用 `--db <路径>`，或设环境变量 `DR_DB`：

```bash
node dist-cli/cli.cjs person.list --db ~/my-record.sqlite
```

**和网页版的数据是互通的**：把浏览器里导出的 `.drp.zip` 解出 `library.json` 后用 `io.importLibrary` 灌进来，
或者用 CLI 建好数据后用 `io.exportLibrary` 导出，再转成 `.drp.zip` 从网页版导入。设备 ID 存在库里的 `meta.cli_device_id`，
所以同一台机器上反复跑 CLI，同步时不会被当成一堆不同的设备。

## 三条命令

```bash
cli.cjs tools                    # 全部工具目录（按分组）
cli.cjs tools --group person     # 只看某一组
cli.cjs help event.create        # 某个工具的参数说明
cli.cjs version
```

## 调用工具

```bash
cli.cjs <工具名> [--参数 值 ...]
```

参数写法：`--k v`、`--k=v`、`--k`（布尔开关）。
布尔/数字/JSON 参数都会按工具声明自动转型，所以 `--rating 5` 直接就是数字，
`--tags '["朋友","同事"]'` 直接就是数组。

```bash
# 建人物、写属性
cli.cjs person.create --displayName 张三 --tags '["朋友"]'
cli.cjs person.attrDefUpsert --key phone --label 电话 --type phone
cli.cjs person.setAttr --id p_xxx --key phone --value 13800000000

# 记一件事
cli.cjs event.create --title "第一次吃饭" --kind meal --time 2024-05-01T18:30 \
  --participants '["p_xxx"]' --content "去了那家日料" --rating 5

# 聊天形式的事件里插消息
cli.cjs chat.append --eventId e_xxx --body "今晚吃了日料" --side right
cli.cjs chat.insertAt --eventId e_xxx --anchorId msg_xxx --where above --body "补充一句"

# 查
cli.cjs event.list --personId p_xxx --from 2024-01-01 --limit 20
cli.cjs system.sql --sql "SELECT title, start_ts FROM events ORDER BY start_ts DESC LIMIT 5"

# 备份 / 回退
cli.cjs snapshot.create --note "大改之前"
cli.cjs snapshot.list
cli.cjs snapshot.restore --id snap_xxx
```

### 全局参数

| 参数 | 说明 |
| --- | --- |
| `--db <路径>` | 库文件位置，默认 `./dating-record.sqlite`（或 `DR_DB`） |
| `--no-snapshot` | 写操作前**不**自动拍快照（默认会拍） |
| `--compact` | 输出单行 JSON（默认缩进格式，人和脚本都能读） |

## 输出与退出码

- 工具结果一律走 **stdout**，格式是 JSON——可以直接 `| jq` 喂给别的程序。
- 出错信息走 **stderr**，退出码 `1`；未知命令退出码 `2`。
- 每次写库操作前会自动拍一个快照（`snapshot.create` 那一族除外），
  结果里会带一个 `_snapshot` 字段记下快照 id。误操作了：
  `cli.cjs snapshot.restore --id <那个id>` 就能整笔退回。

```bash
$ cli.cjs person.create --displayName 张三 --compact
{"id":"p_01M5K99TH350BDSDYHVPW80M38","displayName":"张三",...}
```

## 工具清单（速查）

| 分组 | 能干什么 |
| --- | --- |
| `person.*` | 人物增删改查、属性定义与属性值、属性历史、查重、合并、模板 |
| `event.*` | 事件增删改查、回收站、隐私标记、类型字典、全局统计 |
| `chat.*` | 聊天事件的增删改查、插播、上移下移 |
| `collection.*` | 事件集树、增删改、移动、成员增删、智能集合规则 |
| `file.*` | 附件列表/详情/重命名/删除/隐私/访问地址/批量转移事件引用（`file.transferRefs`）/ 映射文件（`file.addMapping`、`file.probeLink`） |
| `playlist.*` | 歌单（文件库里的 `.drpl`）：列出/详情/新建/保存（改名、改描述、整表换曲目）/导入 JSON/删除 |
| `snapshot.*` | 快照创建、列表、恢复、删除 |
| `io.*` | 整库导出/导入、事件集分享的打包/预览/导入、读取本地文本文件内容（`io.readFile`） |
| `system.*` | 库概览、只读 SQL、表结构、操作记录、meta 读写 |

完整说明随时用 `cli.cjs tools` 和 `cli.cjs help <工具名>` 查，那是最新的。

## 只读 SQL 的口子

`system.sql` 允许执行单条 `SELECT` / `WITH` / `EXPLAIN`，表结构用 `system.schema` 看。
它刻意不放行写语句——要写数据就走对应的工具，那样才有快照保护和 oplog 记录。

## 给 AI 用

CLI 的存在意义就是让 AI（或任何脚本）能操作本地库：

1. **能力清单是机器可读的**：`src/core/tools/registry.ts` 里的 `toolSchemas()`
   输出 OpenAI function calling 格式，`toolCatalogText()` 输出纯文本目录，
   两种形态给两种模型用。
2. **每个工具都声明了 `mutating`**：AI 一轮对话里第一次调写库工具前会自动拍快照
   （浏览器里的 AI 对话同理），踩错了整轮可退。
3. **新增功能的约定**：能力写在 `src/core/repo`，然后在 `src/core/tools` 里声明一条
   `ToolDef`。UI、CLI、AI 三条路自动同时获得新能力，不用各接一遍。
   加工具时记得想清楚 `mutating` 标不标——标了才有自动快照保护。

## 常见问题

**Q：CLI 改的数据，网页版能看到吗？**
A：能。把 `dating-record.sqlite` 对应的库导入网页版即可（`io.exportLibrary` 导出 →
网页版导入），或者反过来。两边格式完全一致。

**Q：快照会不会把磁盘撑爆？**
A：不会无限囤。默认保留最新 20 份、总字节不超过 64MB，超了自动扔最旧的。

**Q：为什么撤销在 CLI 里不好使？**
A：撤销栈是内存里的，进程退出就没了——CLI 每次都是新进程，等于没有。
所以 CLI 关掉了撤销栈（省内存），改用落盘的快照做回退。
