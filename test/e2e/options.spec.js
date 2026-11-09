// "Keep the text exactly as written", the chapter-title chooser, and the
// privacy-safe problem report.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from '../../vendor/fflate/fflate.mjs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

test('“keep the text exactly as written” turns off the typographic clean-up and is remembered', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', join(fixtures, 'plain-en.txt'));
  await page.click('.preview summary');
  await expect(page.locator('#preview')).toContainText('“Forecasts Within.”');
  await page.check('#faithful');
  await expect(page.locator('#preview')).toContainText('"Forecasts Within."');
  await page.reload();
  await expect(page.locator('#faithful')).toBeChecked();
});

test('chapter titles: automatic fallback is explained, and the user can choose another look', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', join(fixtures, 'plain-titles-en.docx'));
  await expect(page.locator('#toc li')).toHaveText(['The Harbour', 'Salt', 'The Ledger', 'What the Tide Keeps']);
  await expect(page.locator('#headings option').first()).toHaveText('Automatic (found: bold lines)');
  const bold = page.locator('#headings option', { hasText: 'Bold lines · 4 chapters' });
  await expect(bold).toHaveCount(1);
  // choosing a rule rebuilds instantly, without re-reading the file
  await page.selectOption('#headings', { label: await bold.textContent() });
  await expect(page.locator('#toc li')).toHaveCount(4);
  // and the novel with Word headings keeps its automatic chapters
  await page.setInputFiles('#file', join(fixtures, 'novel-es.docx'));
  await expect(page.locator('#headings')).toHaveValue('auto');
  await expect(page.locator('#toc li')).toHaveCount(4);
});

for (const name of ['plain-titles-en.pdf', 'novel-es.docx']) {
  test(`problem report for ${name} hides the text and is made offline`, async ({ page, baseURL }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.setInputFiles('#file', join(fixtures, name));
    const requests = [];
    page.context().on('request', (r) => requests.push(r.url()));
    await page.click('#report-open');
    await page.fill('#report-note', 'chapter titles missing');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#report-create')]);
    expect(download.suggestedFilename()).toMatch(/^manuscript-problem-report-\d{4}-\d{2}-\d{2}\.zip$/);
    const zip = unzipSync(new Uint8Array(readFileSync(await download.path())));
    const json = strFromU8(zip['report.json']);
    const report = JSON.parse(json);
    expect(report.note).toBe('chapter titles missing');
    expect(zip['README.txt']).toBeTruthy();
    const secret = name.endsWith('.pdf') ? /\b(?:Ines|Tomas|Harbour|ledger|grandfather)\b/i : /\b(?:Remei|Vilanova|relojes|abuelo)\b/;
    expect(json.match(secret)?.[0] ?? null).toBeNull();
    if (name.endsWith('.pdf')) expect(report.pdf.pages.length).toBeGreaterThan(0);
    else expect(zip['anonymized.docx'].length).toBeGreaterThan(1000);
    await expect(page.locator('#report-done')).toBeVisible();
    for (const u of requests) expect(u.startsWith('blob:') || u.startsWith(baseURL), u).toBe(true);
  });
}

test('chapter titles can be edited or numbered, and the EPUB and reader use them', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', join(fixtures, 'novel-es.docx'));
  await page.click('#toc-box summary');
  await page.click('#number-titles');
  await expect(page.locator('#toc li')).toHaveText(['Capítulo 1', 'Capítulo 2', 'Capítulo 3', 'Epílogo']);
  await page.click('#edit-titles');
  await page.locator('#toc input').nth(2).fill('El sótano');
  await page.click('#edit-titles');
  await expect(page.locator('#toc li').nth(2)).toHaveText('El sótano');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const files = unzipSync(new Uint8Array(readFileSync(await download.path())));
  const nav = strFromU8(files['OEBPS/nav.xhtml']);
  expect(nav).toContain('>Capítulo 2</a>');
  expect(nav).toContain('>El sótano</a>');
  await page.click('#read');
  await expect(page.locator('.r-chapter-title')).toHaveText('Capítulo 1');
});
