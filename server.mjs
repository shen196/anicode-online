import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
const skipData = !!process.env.SKIP_DATA;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const compressible = /\.(html|js|css|json|svg)$/i;

http.createServer((req, res) => {
  let url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/' || /^\/\d{6}$/.test(url)) url = '/index.html';
  // SKIP_DATA serves the same app with the bundled 200-title fallback pool. It
  // keeps a free tunnel usable when the full 5 MB list would take minutes.
  if (skipData && url === '/anime_list.json') { res.writeHead(404); res.end('not found'); return; }
  const file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    let body = data;
    if (compressible.test(file) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = zlib.gzipSync(data);
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}).listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port));
