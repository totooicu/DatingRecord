// 数据库引擎的本地缓存：sql-wasm.wasm 下一次，之后都读本地。
//
// 先回答「引擎是不是固定代码」：是。它是 sql.js 发布包里编译好的二进制
// （public/sql-wasm.wasm，685KB），既不含业务代码也不含用户数据，
// 只要 package.json 里的 sql.js 版本不变，它一个字节都不会变——
// 改业务代码不会变、重新部署不会变、换手机打开还是同一个文件。
// 所以它完全值得缓存，而且缓存了也不会「读到旧逻辑」。
//
// 那为什么以前每次刷新都要重下？
//   1. 应用每次启动都自己 fetch 一遍（core/db/index.ts），只靠浏览器 HTTP 缓存；
//      GitHub Pages 给静态资源的是短 max-age，过期就得重新拉。
//   2. Service Worker 的缓存名每次构建都换（scripts/bust-sw.mjs），
//      activate 时把上一个版本的缓存整批清掉，wasm 跟着一起被丢。
// 于是「发一次版 / 隔一阵打开」就会看到「正在下载数据库引擎…」。
//
// 这里的做法：把引擎字节放进一个**名字固定的** Cache Storage 桶（dr-wasm-v1），
// 它不跟着 SW 的版本缓存一起被清。启动顺序变成：
//   命中 → 直接用本地字节初始化（零网络请求，进度条直接跳到「启动引擎」）
//   未命中 → 照旧带进度地下载，下完顺手写进这个桶
//
// 为什么用 Cache Storage 而不是 IndexedDB：IDB 是主库二进制的地盘，
// 新增 store 要升 IDB_VERSION、让所有老用户走一次升级；Cache Storage 是独立的，
// 而且 SW 也能直接复用同一个桶（见 public/sw.js），两条路共用一份缓存。
//
// 升级 sql.js 时：把下面 CACHE 里的 v1 改成 v2，旧缓存立即失效（不会被读到），
// 老桶会在下一次启动被顺手清掉。

/** 桶名固定，不随构建版本变化 */
const CACHE = 'dr-wasm-v1';

/** 完整引擎约 685KB；比这小得多的多半是半截响应或错误页，不能拿来初始化 */
const MIN_BYTES = 200_000;

function hasCacheApi(): boolean {
  return typeof caches !== 'undefined' && typeof caches.open === 'function';
}

/** wasm 文件头四个字节恒为 \0asm，用它挡住损坏的缓存 */
function looksLikeWasm(buf: ArrayBuffer): boolean {
  if (buf.byteLength < MIN_BYTES) return false;
  const head = new Uint8Array(buf, 0, 4);
  return head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d;
}

/**
 * 读本地缓存的引擎。没有、坏了、环境不支持都返回 null——
 * 调用方接到 null 就走原来的下载路径，功能不受影响。
 */
export async function readCachedWasm(url: string): Promise<ArrayBuffer | null> {
  if (!hasCacheApi()) return null;
  try {
    const c = await caches.open(CACHE);
    const res = await c.match(url);
    if (!res) return null;
    const buf = await res.arrayBuffer();
    return looksLikeWasm(buf) ? buf : null;
  } catch {
    return null;
  }
}

/** 把下载到的引擎存一份，下次直接用 */
export async function writeCachedWasm(url: string, bytes: ArrayBuffer): Promise<void> {
  if (!hasCacheApi() || !looksLikeWasm(bytes)) return;
  try {
    const c = await caches.open(CACHE);
    await c.put(url, new Response(bytes, { headers: { 'content-type': 'application/wasm' } }));
  } catch {
    // 存不上不影响这次启动（例如隐私模式），下次再试
  }
}

/**
 * 丢掉缓存：只有在「拿缓存初始化失败」时才用——
 * 说明缓存里的引擎和当前代码不匹配，留着只会每次都失败。
 */
export async function clearCachedWasm(url: string): Promise<void> {
  if (!hasCacheApi()) return;
  try {
    const c = await caches.open(CACHE);
    await c.delete(url);
  } catch {
    /* ignore */
  }
}
