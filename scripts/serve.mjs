// Minimal static server for local testing and the e2e tests (no dependencies).
//   node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.pdf': 'application/pdf', '.docx': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};
// Only the files that GitHub Pages publishes (see .github/workflows/ci.yml).
const PUBLIC = /^\/(index\.html|app\.css|sw\.js|manifest\.webmanifest|icons\/.+|src\/.+|vendor\/.+)?$/;

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!PUBLIC.test(path) || path.includes('..')) { res.writeHead(404).end('not found'); return; }
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  try {
    if (!(await stat(file)).isFile()) throw new Error('dir');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`serving on http://localhost:${port}`));
