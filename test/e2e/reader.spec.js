// The in-browser reader: navigation, notes, settings, resume, privacy.
import { test, expect } from '@playwright/test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const STATIC = /^\/(index\.html|app\.css|sw\.js|manifest\.webmanifest|icons\/[\w.-]+|src\/[\w/.-]+\.js|vendor\/[\w/.-]+\.mjs)?$/;

async function openBook(page, name = 'novel-es.docx') {
  await page.goto('/');
  await page.setInputFiles('#file', join(fixtures, name));
  await page.click('#read');
  await expect(page.locator('#reader')).toBeVisible();
}
const progress = (page) => page.locator('.r-progress').textContent();
// The progress line is filled after layout (next animation frame): use the
// retrying assertion, never a one-off read, to check it.
const expectProgress = (page, re) => expect(page.locator('.r-progress')).toHaveText(re);

test('opens the book, turns pages and chapters, jumps from the contents', async ({ page }) => {
  await openBook(page);
  await expect(page.locator('.r-chapter-title')).toHaveText('Capítulo 1. La llegada');
  await expect(page.locator('.r-title')).toHaveText('La casa de los relojes');
  await expectProgress(page, /^Chapter 1\/4 · page 1\/\d+ · 0%$/);
  await page.keyboard.press('ArrowRight');
  await expectProgress(page, /page 2\//);
  await page.keyboard.press('ArrowLeft');
  await expectProgress(page, /page 1\//);
  // keep turning until chapter 2
  for (let k = 0; k < 30 && !(await progress(page)).startsWith('Chapter 2'); k++) await page.click('[aria-label="Next page"]');
  await expect(page.locator('.r-chapter-title')).toHaveText('CAPÍTULO 2. Los relojes');
  // previous from the first page of chapter 2 lands on the LAST page of chapter 1
  await page.click('[aria-label="Previous page"]');
  await expectProgress(page, /^Chapter 1\//);
  const p = await progress(page);
  const [, cur, tot] = p.match(/page (\d+)\/(\d+)/);
  expect(p.startsWith('Chapter 1')).toBe(true);
  expect(cur).toBe(tot);
  await page.click('#reader-toc');
  await page.click('.r-toc >> text=Epílogo');
  await expect(page.locator('.r-chapter-title')).toHaveText('Epílogo');
  await expect(page.locator('.r-the-end')).toBeAttached();
});

test('footnotes open in a popup', async ({ page }) => {
  await openBook(page);
  await page.click('#reader-toc');
  await page.click('.r-toc >> text=CAPÍTULO 2. Los relojes');
  await page.click('[aria-label="Display settings"]');
  await page.click('.r-choice >> text=Scroll');
  await page.click('[aria-label="Close settings"]');
  await page.locator('.r-noteref').first().click();
  await expect(page.locator('.r-note')).toBeVisible();
  await expect(page.locator('.r-note')).toContainText('Besançon fue durante siglos la capital relojera de Francia.');
  await page.keyboard.press('Escape');
  await expect(page.locator('.r-note')).toBeHidden();
  await expect(page.locator('#reader')).toBeVisible();
});

test('close button and the browser back button return to the converter', async ({ page }) => {
  await openBook(page);
  await page.click('#reader-close');
  await expect(page.locator('#reader')).toBeHidden();
  await expect(page.locator('#download')).toBeVisible();
  await page.click('#read');
  await expect(page.locator('#reader')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#reader')).toBeHidden();
  await expect(page.locator('#title')).toHaveValue('La casa de los relojes');
});

test('reopening the same file resumes where you left off; settings persist', async ({ page }) => {
  await openBook(page);
  await page.click('#reader-toc');
  await page.click('.r-toc >> text=Capítulo 3: El sótano');
  await page.click('[aria-label="Display settings"]');
  await page.click('.r-choice >> text=Sepia');
  await page.click('[aria-label="Larger text"]');
  await page.click('[aria-label="Close settings"]');
  await page.click('#reader-close');
  // a fresh page load, same file
  await openBook(page);
  await expect(page.locator('.r-chapter-title')).toHaveText('Capítulo 3: El sótano');
  await expect(page.locator('#reader')).toHaveAttribute('data-theme', 'sepia');
  await expectProgress(page, /^Chapter 3\/4/);
});

test('reading makes no network requests and stores no manuscript text', async ({ page, baseURL }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const requests = [];
  page.context().on('request', (r) => requests.push(r));
  await page.setInputFiles('#file', join(fixtures, 'novel-es.pdf'));
  await page.click('#read');
  for (let k = 0; k < 8; k++) await page.keyboard.press('ArrowRight');
  await page.click('#reader-toc');
  await page.click('.r-toc >> text=Epílogo');
  for (const r of requests) {
    const u = new URL(r.url());
    if (u.protocol === 'blob:' || u.protocol === 'data:') continue;
    expect(u.origin).toBe(new URL(baseURL).origin);
    expect(r.method()).toBe('GET');
    expect(u.pathname).toMatch(STATIC);
  }
  const stored = await page.evaluate(() => Object.keys(localStorage).map((k) => k + '=' + localStorage.getItem(k)).join('\n'));
  expect(stored).not.toMatch(/relojes|Remei|Vilanova|Marta/);
  expect(stored).toMatch(/mr-pos-/);
});

test('manuscript text cannot inject markup or scripts', async ({ page }) => {
  await page.goto('/');
  const evil = 'CHAPTER ONE\n\nHello <img src=x onerror="window.__pwned=1"> and <script>window.__pwned=2</script> &amp; <b>not bold</b> world, a paragraph long enough to read.\n';
  await page.setInputFiles('#file', { name: 'evil.txt', mimeType: 'text/plain', buffer: Buffer.from(evil) });
  await page.click('#read');
  await expect(page.locator('.r-content')).toContainText('<img src=x onerror=');
  await expect(page.locator('.r-content')).toContainText('<script>window.__pwned=2</script>');
  await expect(page.locator('.r-content img, .r-content script, .r-content p b')).toHaveCount(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

for (const layout of ['Pages', 'Scroll']) {
  test(`${layout} layout fits the screen without horizontal page scroll`, async ({ page }) => {
    await openBook(page, 'bilingual-ca-en.pdf');
    await page.click('[aria-label="Display settings"]');
    await page.click(`.r-choice >> text=${layout}`);
    await page.click('[aria-label="Close settings"]');
    const m = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - window.innerWidth,
      bar: document.querySelector('.r-bottom').getBoundingClientRect().bottom - window.innerHeight,
    }));
    expect(m.doc).toBeLessThanOrEqual(0);
    expect(m.bar).toBeLessThanOrEqual(1);
    // the visible text is inside the viewport (pages mode: the current page only)
    const vp = await page.locator('.r-viewport').boundingBox();
    const firstP = await page.locator('.r-content p').first().boundingBox();
    expect(firstP.x).toBeGreaterThanOrEqual(vp.x);
    expect(firstP.x + firstP.width).toBeLessThanOrEqual(vp.x + vp.width + 1);
  });
}

test('the chapter in another language carries its lang attribute (hyphenation, dictionary)', async ({ page }) => {
  await openBook(page, 'bilingual-ca-en.docx');
  await expect(page.locator('.r-content')).toHaveAttribute('lang', 'ca');
  await page.click('#reader-toc');
  await page.click('.r-toc >> text=Letter from Brighton');
  await expect(page.locator('.r-content')).toHaveAttribute('lang', 'en');
});
