# 坚果云 WebDAV 反向代理

解决一个问题：坚果云的 WebDAV **不返回 CORS 头**，于是网页（ dating-record 的同步功能）想直接连
`https://dav.jianguoyun.com/dav` 会被浏览器的同源策略在发出请求前拦掉，报 `Failed to fetch`。
AI 服务（硅基流动 / OpenAI…）之所以能连，是因为它们**主动返回**了 `Access-Control-Allow-Origin`——
这是服务端配置的差异，不是客户端代码能绕过的。

这个代理做的事很简单：把请求原样转发给坚果云，再**自己补上 CORS 头**，于是网页就能正常用了。
代理不存任何账号密码，Basic Auth 头由浏览器直接带来、原样转发；备份内容本身仍靠 Basic Auth 保护。

---

## 关于「放在 GitHub 上」

GitHub Pages 是**纯静态**托管，没有服务端逻辑，没法给请求加 CORS 头——所以它本身当不了代理。
但你可以把下面任一份脚本放在 GitHub 仓库里管理，再部署到能跑服务端代码的地方：

| 方式 | 文件 | 适合 | 费用 |
|---|---|---|---|
| Cloudflare Workers | `worker.js` + `wrangler.toml` | 长期、公网、零运维 | 免费额度足够个人用 |
| 本地 / 自有服务器 | `server.mjs` | 本机调试、家里有小机器 | 电费 |

---

## 方式一：Cloudflare Workers（推荐，几分钟）

```bash
npm i -g wrangler
wrangler login
wrangler deploy          # 在本目录执行，读 worker.js + wrangler.toml
```

部署完会得到一个 `https://<名字>.workers.dev` 地址。
到 App「设置 → 坚果云备份 → 高级 → 服务地址」填：

```
https://<名字>.workers.dev/dav
```

（注意结尾带 `/dav`，和直连地址一致。）

---

## 方式二：本地 / 自有服务器（Node，零依赖）

```bash
node server.mjs                 # 默认 8787 端口
PORT=9000 node server.mjs      # 自定义端口
```

然后「服务地址」填：

```
http://<机器IP或localhost>:8787/dav
```

本机调试可直接用 `localhost`；要让手机/其他设备访问，把 `localhost` 换成跑代理那台机器的内网/公网 IP，
并确保该端口可被访问（公网的话记得用 HTTPS 或放在反向代理后面，避免 Basic Auth 明文裸奔）。

---

## 验证

部署后，浏览器直接打开 `<你的代理>/dav/<随便一个目录>` 应能得到 XML 响应（401 是正常的，说明通了但没带凭证）。
再到 App 里点「测试连接」即应显示成功。
