// Service Worker：本地优先 + 版本驱动增量更新。
//
// 工作流程：
//   1. install 时 precache 核心文件，wasm 进长期桶，然后 fetch version.json
//   2. fetch 静态资源 cache-first：有缓存直接返回（秒开），后台对比版本
//   3. 后台 fetch version.json，对比 subversion hash：
//      · 整体 version 没变 → 什么都不做
//      · 个别文件 hash 变了 → 只重新下载那几个文件
//      · 整体 version 变了 → 全量重新 precache
//   4. wasm 独立长期桶，跨版本不清，685KB 只下一次
//
// 用户数据在 IndexedDB，SW 完全不碰。

const CACHE = 'dating-record-2026-10-25T03-25-17-087Z';
const VERSION_URL = './version.json';

// 数据库引擎专用桶：名字固定，不随构建版本变化。
const WASM_CACHE = 'dr-wasm-v1';
const WASM_URL = './sql-wasm.wasm';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './icon.svg',
  './edge-split.html',
];

// 后台对比 version.json，更新变化的文件
async function checkVersion() {
  try {
    const res = await fetch(VERSION_URL, { cache: 'no-cache' });
    if (!res || !res.ok) return;
    const latest = await res.json();
    const cache = await caches.open(CACHE);

    let old = null;
    try {
      const oldRes = await cache.match(VERSION_URL);
      if (oldRes) old = await oldRes.json();
    } catch { /* ignore */ }

    if (old && old.version === latest.version) return;

    const oldMap = new Map((old?.subversion ?? []).map((f) => [f.link, f.version]));
    const toUpdate = (latest.subversion ?? []).filter((f) => oldMap.get(f.link) !== f.version);

    const targets = (!old)
      ? PRECACHE
      : toUpdate.map((f) => '.' + f.link);

    if (targets.length) await cache.addAll(targets);

    await cache.put(VERSION_URL, new Response(JSON.stringify(latest), {
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch { /* 离线静默 */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE);
      const wasm = await caches.open(WASM_CACHE);
      if (!(await wasm.match(WASM_URL))) await wasm.add(WASM_URL);
      await self.skipWaiting();
    })().then(checkVersion),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE && k !== WASM_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim())
      .then(checkVersion),
  );
});

// 导航请求带超时的网络请求：保证「发版后第一次刷新」就能拿到新的 index.html
// （cache-first 会先返回旧壳，用户得刷新两次才看得到更新）。断网或网络太慢时
// 立刻退回缓存，不至于卡住白屏。
function fetchIndex(req) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 2500);
    fetch(req, { cache: 'no-cache' }).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // version.json 永远走网络
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(fetch(req, { cache: 'no-cache' }));
    return;
  }

  // sw.js 本身 network-first
  if (url.pathname.endsWith('/sw.js')) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  // wasm 长期桶优先
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

  // 导航请求：网络优先（2.5s 超时），失败再退回缓存。
  // 之前是 cache-first，发版后用户要刷新两次才能看到新版本。
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetchIndex(req);
          if (res && res.status === 200) {
            const copy = res.clone();
            const cache = await caches.open(CACHE);
            await cache.put('./index.html', copy);
            checkVersion();
            return res;
          }
          throw new Error('bad status');
        } catch {
          const cached = await caches.match('./index.html');
          if (cached) {
            checkVersion();
            return cached;
          }
          return fetch(req, { cache: 'no-cache' });
        }
      })(),
    );
    return;
  }

  // 静态资源：cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    }),
  );
});
