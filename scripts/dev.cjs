const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const request = require('../api/request.js');
const admin = require('../api/admin.js');

const publicRoot = path.resolve(__dirname, '..', 'vercel-public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

function createApp() {
  return http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (['/request.php', '/api/request'].includes(pathname)) return await request(req, res);
      if (['/admin.php', '/api/admin'].includes(pathname)) return await admin(req, res);
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        return res.end('Method not allowed');
      }
      const file = path.resolve(publicRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(publicRoot + path.sep) || !types[path.extname(file)]) {
        res.writeHead(404);
        return res.end('Not found');
      }
      const content = await fs.promises.readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch {
      if (!res.headersSent) res.writeHead(404);
      res.end('Not found');
    }
  });
}

if (require.main === module) {
  require('./build-vercel.cjs');
  const port = Number(process.env.PORT || 3001);
  createApp().listen(port, '127.0.0.1', () => {
    console.log(`Сайт: http://127.0.0.1:${port}/index.html`);
    console.log(`Админка: http://127.0.0.1:${port}/admin.php`);
  });
}

module.exports = { createApp };
