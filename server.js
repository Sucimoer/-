// 澪鸢 本地静态服务 + 同源 CORS 代理（Node.js，无需管理员权限）
// 作用：
//   1. 以 http://localhost:8123 打开站点，避免 file:// 协议下 origin 为 null 引发的跨域怪问题
//   2. /proxy 转发 CMS 接口请求并补上 CORS 头，绕开"浏览器直连被 CORS 拦截"
//   3. 关键：走你本机网络直连接口，不依赖被 DNS 污染的 workers.dev
// 用法：
//   node server.js
//   然后浏览器打开 http://localhost:8123
//   站点搜索时 core.js 会自动优先走本代理（同源 /proxy），失败再回落 worker。
// 注意：解析失败的接口域名（dbzyapi.com 等）本代理也救不了，但 heimuer/dyttzy/bfzy/360zy 等可用。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
// 云平台（Render 等）通过环境变量注入端口；本地未设置时默认 8123
const PORT = process.env.PORT || 8123;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 防止任意路径穿越（静态服务只允许访问项目目录内文件）
// 注意：url.pathname 以 "/" 开头，path.resolve 会把前导斜杠当作盘根绝对路径
// （如 /js/core.js -> E:\js\core.js），必须先去掉前导斜杠再拼接，否则子路径全部 403。
function safeResolve(p) {
  const clean = (p || '').replace(/^\/+/, '');
  const resolved = path.resolve(ROOT, clean);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  return resolved;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);

  // ---- CORS 代理（二进制安全：arrayBuffer 转发，支持 Range 断点续传）----
  if (url.pathname === '/proxy') {
    const target = url.searchParams.get('url');
    if (!target || !/^https?:\/\//i.test(target)) {
      res.writeHead(400, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('missing url param');
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60000); // 下载大文件放宽到 60s
    try {
      const hdrs = { 'User-Agent': UA, 'Accept': '*/*' };
      if (req.headers.range) hdrs['Range'] = req.headers.range;
      const r = await fetch(target, { method: 'GET', headers: hdrs, signal: ctl.signal });
      const out = {};
      ['content-type', 'content-length', 'accept-ranges', 'content-range', 'content-disposition'].forEach(k => {
        const v = r.headers.get(k);
        if (v) out[k] = v;
      });
      out['Access-Control-Allow-Origin'] = '*';
      res.writeHead(r.status, out);
      const buf = Buffer.from(await r.arrayBuffer()); // 二进制安全，mp4/ts 不损坏
      res.end(buf);
    } catch (e) {
      res.writeHead(502, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('proxy error: ' + e.message);
    } finally {
      clearTimeout(timer);
    }
    return;
  }

  // ---- 静态文件 ----
  const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const filePath = safeResolve(pathname === '' ? 'index.html' : pathname);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log('澪鸢本地服务已启动: http://localhost:' + PORT);
  console.log('浏览器打开上面的地址即可使用（优先走本地代理，不再依赖被污染的 workers.dev）');
});
