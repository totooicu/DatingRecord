// 坚果云 WebDAV 反向代理（Cloudflare Worker）
//
// 作用：浏览器直连 dav.jianguoyun.com 会被同源策略拦下（坚果云 WebDAV 不返回
// CORS 头）。这个 Worker 跑在 *.workers.dev 上，把请求原样转发给坚果云，并自己
// 补上 CORS 头，于是页面就能用「高级 → 服务地址」指到这个 Worker 了。
//
// 部署（免费，约 1 分钟）：
//   1. npm i -g wrangler && wrangler login
//   2. 在本目录执行：wrangler deploy
//   3. 把输出的 https://xxx.workers.dev 记下来，在 App 里填成
//      https://xxx.workers.dev/dav
//
// 安全：Worker 不存任何账号密码，Basic Auth 头由浏览器直接带过来、原样转发。
// 设了 Access-Control-Allow-Origin: *——备份内容本身靠 Basic Auth 保护，
// 只有知道你坚果云应用密码的人才能读写。

const TARGET_BASE = 'https://dav.jianguoyun.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, MKCOL, PROPFIND, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    // 预检：浏览器对 PROPFIND / MKCOL 等非简单动词会先发 OPTIONS，直接回 CORS 即可，
    // 不必真转发（转了坚果云多半回 401，反而坏事）。
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const targetUrl = TARGET_BASE + url.pathname + url.search;

    const headers = new Headers(request.headers);
    // 这些头会让目标拒绝或产生跨域，清掉让目标自己判断
    headers.delete('host');
    headers.delete('origin');
    headers.delete('referer');

    const init = { method: request.method, headers, redirect: 'follow' };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      init.duplex = 'half';
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl, init);
    } catch (e) {
      return new Response('代理转发失败：' + (e instanceof Error ? e.message : String(e)), {
        status: 502,
        headers: CORS,
      });
    }

    const out = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    return out;
  },
};
