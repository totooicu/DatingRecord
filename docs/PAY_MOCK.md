# 一次性服务购买：壳当收费服务器（测试线协议）

**这条线只在 `test/payment-recharge` 上，不进 main。** 目的：在没有商户号、没有 SDK 密钥的前提下，
把「买一次性的服务」整条路跑通并可回归——包括**真跳支付宝 / 微信**那一步的管道。

## 0. 边界先说清楚

- **没有真钱**。壳发的 `alipays://` / `weixin://` 链接长得跟真的一样（scheme + 参数结构一致），
  但里面的 `orderVo` / `prepayId` 是假的，真 app 打开只会报「订单不存在」。
  这一跳要验的是**壳能不能拦住自定义 scheme 并把它交给系统去拉 app**，不是能不能收到钱。
  将来接商户号，只换服务器签名那一段，**页面一行都不用改**。
- **一次性服务，不是余额**。没有「充值 30 元以后慢慢花」这种账户余额，也不做自动续费。
  一张订单 = 买一个服务 = 一条购买记录。买完就结清，扣次数、到期那套都不做。
- **到账以查单为准**。异步通知（`/__pay/notify`）只当"提醒"，页面收到就顺手查一次单；
  通知丢了也能靠查单补上。**幂等靠 `orderId`**：同一张单被通知两次、查单三次，都不许多记一条购买。

## 1. 服务器：壳的局域网 HTTP 服务（`DataShareServer`，默认 4173）

复用数据共享那个服务器，路由前缀 `/__pay/`，与 `/__remote/*` 同一风格。请求 / 响应都是 JSON（UTF-8）。

### `POST /__pay/order` 下单

```jsonc
// 请求
{
  "service": { "id": "ocr.pass", "title": "一次性通行凭证", "amountCents": 600 },
  "returnUrl": "http://127.0.0.1:4173/?pay_done=1",  // 收银台付完跳回哪（可空）
  "channel": "alipay"                                 // 可选：下单就锁定渠道
}
// 响应 200
{
  "orderId": "PAY-20261101-0001",
  "status": "pending",
  "amountCents": 600,
  "currency": "CNY",
  "expireAt": 1793520000000,           // 毫秒；过期后 action=pay 会被拒
  "channels": [
    {
      "kind": "alipay",
      "label": "支付宝",
      "scheme": "alipays://platformapi/startapp?appId=099999&orderVo=PAYMOCK-PAY-20261101-0001",
      "webUrl": "/__pay/cashier?order=PAY-20261101-0001&channel=alipay"
    },
    {
      "kind": "wechat",
      "label": "微信",
      "scheme": "weixin://app/paymock/pay?prepayId=PAYMOCK-PAY-20261101-0001",
      "webUrl": "/__pay/cashier?order=PAY-20261101-0001&channel=wechat"
    }
  ]
}
```

规则：
- **同一 `service.id` + 同一金额、且仍是 `pending` 的订单，重复下单返回同一张**（幂等，不攒一堆待支付单）；
  已经 `paid` 的服务再下单会返回一张**新**单（一次性服务允许买第二次）。
- 金额单位一律**分**（`amountCents`），页面显示时才 `/100`。禁止浮点传钱。
- 服务目录由页面带上去，服务器不存目录——壳只负责"这单多少钱、付了没"。

### `GET /__pay/order?id=PAY-…` 查单

```jsonc
{ "orderId": "PAY-20261101-0001", "status": "paid", "amountCents": 600,
  "paidAt": 1793519900000, "tradeNo": "MOCK202611010001", "channel": "alipay",
  "expireAt": 1793520000000 }
```

状态只有 6 个：`pending` / `paid` / `failed` / `cancelled` / `expired` / `refunded`。
不存在的 id → 404 `{"error":"order_not_found"}`。

### `POST /__pay/order?id=PAY-…&action=pay|fail|cancel|expire|refund` 手动驱动

壳的测试页和回归脚本都用它。**终态不可逆**：`paid` 之后 `action=pay` 返回同样的 `tradeNo`（幂等），
`action=cancel` 会被拒（`409 {"error":"bad_transition"}`）；只有 `refund` 能从 `paid` 走。

### `POST /__pay/notify?id=PAY-…` 模拟异步回调

返回 `{"ok":true,"orderId":…,"status":…}`。带 `&times=2` 就是**连发两次同样的通知**，专门用来打幂等。
（这一期只统计"回调了几次"，不做签名校验——那是接真商户号时才值钱的东西。）

### `GET /__pay/cashier?order=…&channel=…` 假收银台（HTML）

一张像收银台的页面，三个按钮：`确认支付` / `支付失败` / `取消`。点哪个就 `POST /__pay/order?action=…`，
然后跳 `returnUrl`，并带 `?orderId=&status=`（页面回跳后立刻查单，这样"从 app 里退回来"和"关掉标签再打开"
两条路都靠同一个入口收敛）。

### `GET /__pay/orders` 列全部（调试 / 回归用）

返回 `{ "orders": [ …同查单结构… ] }`，按下单时间升序。

## 2. 壳里那一跳：自定义 scheme 拦截

GeckoView 默认会把 `alipays://` 这种非 http(s) 请求丢给页面自己处理，结果是点了没反应。所以要：

1. `Session.Callback.onLoadRequest` 里认 `alipays` / `weixin` / `alipay` 三个 scheme；
2. 起 `Intent(ACTION_VIEW, uri)`，`try/catch ActivityNotFound`：
   - 拉起来了 → 返回 `RESPOND`（WebView 不跟着走）；
   - **没装 app** → 不白屏：把这一跳转成壳自己的假收银台（`webUrl`），并在页面上留一句
     「没检测到支付宝 / 微信，已改用网页收银台」。

判「装没装」用 `packageManager.getLaunchIntentForPackage()`，不靠 catch 猜包名。
`AndroidManifest` 需要 `<queries>` 声明这两个包，否则 Android 11+ 上 `getLaunchIntentForPackage`
永远返回 null——**这是最容易踩的一条**，写进代码注释。

浏览器里（没有壳）这一跳点了没反应是**预期行为**，所以页面在跳转前一定同时给一条网页收银台的退路。

## 3. 页面侧

- 核心层 `src/core/pay/`：订单表（schema v15，`pay_orders`）+ 购买记录，状态机、幂等应用查单结果都在这里；
- 服务器地址在 `src/core/pay/server.ts` 的 `resolvePayBase()` 里定：**手填地址优先**；留空就复用
  `remote/shellRelay.ts` 那条 `remote.status` 桥拿到的局域网端口——`/__pay/*` 挂在壳那个
  `DataShareServer` 上，跟跨设备同步是同一个 server，**没有新的桥、也没有新的端口**；两边都没有时
  页面直说「没有可用收费服务器」，买按钮全灰（浏览器里测就手填一个本地 mock 的地址）；
- UI 挂在设置「功能面板」下面一条「服务购买（测试）」：目录、下单、待支付订单（带「查单」「继续支付」）、购买记录。

## 4. 回归

- 壳：`tools/pay-test/run.sh`（照 `tools/datashare-test/run.sh` 的样子 `javac` 起真服务器 + Node 客户端走协议）；
- 网页：`tools/e2e/pay-one-time-e2e.mjs`——**直接编译并拉起壳那份 Java 服务器**（`../geckoview_example`），
  这样协议只有一份实现，跨仓对不上会当场红。
