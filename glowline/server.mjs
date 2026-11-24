// Tiny dependency-free static server. Browsers only allow screen/microphone capture
// in a secure context, and http://localhost counts as one; file:// does not load ES modules.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SERVED = new Set(['index.html', 'overlay.html', 'styles.css', 'overlay.css', 'src']);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function createAppServer(root = ROOT) {
  return createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path === '/') path = '/index.html';
      const rel = normalize(path).replace(/^[\\/]+/, '');
      const top = rel.split(/[\\/]/)[0];
      const file = join(root, rel);
      if (rel.includes('..') || !SERVED.has(top) || !file.startsWith(root.endsWith(sep) ? root : root + sep)) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      }).end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--port');
  const port = i > -1 ? Number(process.argv[i + 1]) : 5173;
  createAppServer().listen(port, '127.0.0.1', () => {
    console.log(`Glowline running at http://localhost:${port}  (Ctrl+C to stop)`);
  });
}
