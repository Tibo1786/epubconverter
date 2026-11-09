// Guards for the static site: offline cache list complete, CSP intact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

test('the service worker precaches every app module and nothing missing', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const assets = [...sw.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]).filter((a) => a !== './');
  for (const a of assets) assert.ok(existsSync(join(root, a)), `listed but missing: ${a}`);
  const modules = walk(join(root, 'src')).map((f) => relative(root, f).replace(/\\/g, '/'));
  for (const m of modules) assert.ok(assets.includes(m), `not precached (offline would break): ${m}`);
});

test('index.html keeps its strict Content-Security-Policy and loads nothing external', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  for (const d of ["default-src 'none'", "script-src 'self'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(csp.includes(d), d);
  assert.ok(!/unsafe-inline|unsafe-eval|https?:\/\/[^"]*\.(js|css)/.test(csp));
  assert.ok(!/<script(?![^>]*src="src\/)/.test(html), 'only same-origin module scripts');
  assert.ok(!/(src|href)="https?:\/\/(?!github\.com)/.test(html), 'no external resources');
});
