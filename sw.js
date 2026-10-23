// Service Worker：只缓存静态资源，让应用可以离线打开、可「添加到主屏幕」。
// 注意：用户的数据存在 IndexedDB 里，SW 完全不碰，也不会上传任何东西。

// 占位符：构建时由 scripts/bust-sw.mjs 替换成带构建时间戳的缓存名。
// 这样每次重新构建都会生成不同的 sw.js 内容，浏览器才会重新安装 SW、
// 丢弃旧缓存 —— 否则旧 SW 会一直用 13:36 那版预缓存的页面，表现为「改了却不生效」。
const CACHE = 'dating-record-2026-10-23T13-01-34-826Z';

// 数据库引擎专用桶：名字固定，不随构建版本变化。
// 引擎是固定二进制（685KB），以前跟版本缓存一起被清，发一次版就要重新下一遍。
// 页面侧（src/core/db/wasmCache.ts）用的是同一个桶名，SW 与页面共用一份缓存。
// 升级 sql.js 时把 v1 改成 v2，与 wasmCache.ts 同步改。
const WASM_CACHE = 'dr-wasm-v1';
const WASM_URL = './sql-wasm.wasm';

// 构建后带 hash 的资源走运行时缓存；这里先预缓存固定入口与体积较大的 wasm
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './icon.svg',
  // 「功能体验」页里的边缘分割工具：一个独立静态页，跟应用一起离线可用
  './edge-split.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE);
      // 引擎单独存进长期桶，且只在桶里没有时才下——已有缓存就一个字节都不再请求
      const wasm = await caches.open(WASM_CACHE);
      if (!(await wasm.match(WASM_URL))) await wasm.add(WASM_URL);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // 引擎桶要留着：它是跨版本复用的，清掉就等于下次打开又得重下 685KB
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE && k !== WASM_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 只处理同源静态资源，跨域请求（如果将来接 AI）直接放行
  if (url.origin !== self.location.origin) return;

  // 导航请求（HTML）必须 network-first。
  // 若对 HTML 也用 stale-while-revalidate，用户会一直拿到缓存里的旧 index.html，
  // 而它引用的带 hash 资源早已被新版本清掉 —— 表现为「改了却没生效」甚至白屏。
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html'))),
    );
    return;
  }

  // 数据库引擎：长期桶优先，命中就直接用，不必等网络
  if (url.pathname.endsWith('/sql-wasm.wasm')) {
    event.respondWith(
      caches.open(WASM_CACHE).then((c) =>
        c.match(req).then((hit) => {
          if (hit) return hit;
          return fetch(req).then((res) => {
            if (res && res.status === 200) c.put(req, res.clone());
            return res;
          });
        }),
      ),
    );
    return;
  }

  // 静态资源：stale-while-revalidate（带 hash 的资源不会互相污染）
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);

      return cached || network;
    }),
  );
});
