// 坚果云 WebDAV 反向代理（Node，零依赖）
//
// 和 worker.js 同一个作用：给浏览器补 CORS 头，绕过坚果云 WebDAV 不返回跨域许可的限制。
// 适合：本地开发、或你有台小服务器/树莓派想自己跑一个长期代理。
//
// 跑法：
//   node server.mjs                 # 监听 8787，访问 http://localhost:8787/dav
//   PORT=9000 node server.mjs
// 然后在 App「高级 → 服务地址」填 http://<你的机器IP>:8787/dav
//
// 安全：不存账号密码，Basic Auth 头由浏览器带来、原样转发；CORS 设为 *，
// 靠 Basic Auth 保护内容。

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const TARGET = 'https://dav.jianguoyun.com';
const PORT = Number(process.env.PORT || 8787);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, MKCOL, PROPFIND, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  const target = new URL(TARGET + (req.url || '/'));
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.origin;
  delete headers.referer;
  delete headers.connection;

  const upstream = https.request(target, { method: req.method, headers }, (up) => {
    res.writeHead(up.statusCode || 502, { ...up.headers, ...CORS });
    up.pipe(res);
  });

  upstream.on('error', (e) => {
    res.writeHead(502, CORS);
    res.end('代理转发失败：' + (e instanceof Error ? e.message : String(e)));
  });

  req.pipe(upstream);
});

server.listen(PORT, () => {
  console.log(`坚果云反代已启动： http://localhost:${PORT}/dav  →  ${TARGET}/dav`);
});
