# Manuscript Reader

Turn a manuscript (Word `.docx`, PDF or plain text) into a clean, reflowable **EPUB 3** that reads well on a Kindle, a Kobo, Apple Books or a phone, with highlights and notes.

**Live app:** https://tibo1786.github.io/epubconverter/

Built for a small publishing house that receives unpublished submissions from authors and literary agents in Spanish, Catalan, English and French.

## What it does

- **Word (.docx)**, the best source:
  - keeps italics and bold, including italics that come from styles
  - finds chapters, whether they use Heading styles or are just big, bold, centred text
  - keeps scene breaks (`*`, `***`, `#`, or a blank line)
  - keeps footnotes, which become pop-up notes
  - drops deleted tracked changes and keeps insertions
  - ignores the Word page layout
- **PDF with a text layer**:
  - rebuilds real paragraphs and joins words hyphenated across lines. Real compounds like `franco-suizo` keep their hyphen, and Catalan `col-`/`lecció` becomes `col·lecció` again.
  - removes running headers, footers and page numbers
  - finds chapter headings, footnotes and scene breaks
- **Scanned PDF** (images only): it tells you so and suggests asking for the Word file. There is no OCR.
- **Plain text**: unwraps hard-wrapped lines and understands `_italics_`, `--` and straight quotes.
- **Typography**:
  - curly quotes and apostrophes
  - em dashes
  - « », ¿ ¡ and l·l are kept, and broken forms of l·l are repaired
  - French no-break spaces
  - ligatures and soft hyphens cleaned up
- **Language**: detected automatically (es / ca / en / fr) and set in the EPUB. A chapter or paragraph in another language is tagged separately, so e-reader dictionaries and hyphenation work. You can override it.
- **Output**: a valid EPUB 3, checked with epubcheck, plus an EPUB 2 table of contents for older readers. It has a simple cover and a title page with title, author and an optional *"Confidential submission, received 9 November 2026"* line. Title, author, language and date can be edited before downloading.
- **Read it right here**: an in-browser reader for phones and computers.
  - *Pages* layout: tap the page edges, swipe or use the arrow keys. Wide screens show two pages side by side.
  - *Scroll* layout.
  - Contents menu and pop-up footnotes.
  - Text size, Light/Sepia/Dark theme, serif or sans font, line spacing, justification.
  - Reopening the same file resumes where you stopped. Only the chapter and paragraph number are remembered (keyed by a hash of the file), never the text.
- **On phones**: installable from the browser menu ("Add to Home Screen") and works offline. A **Send to Kindle app…** button shares the EPUB straight to the Kindle app.

## Privacy

Manuscripts are confidential, so **nothing is ever uploaded.** The conversion runs entirely in your browser, and the page is built so that it *cannot* send your file anywhere:

- **Strict Content-Security-Policy** (in [`index.html`](index.html)):
  - `connect-src 'none'` forbids every network request from the page: fetch, XHR, WebSocket and beacons.
  - `default-src 'none'` and `script-src 'self'` allow code only from this site.
  - `form-action 'none'` means no form submissions.
- **No analytics, no cookies, no CDN, no web fonts.** The two libraries ([pdf.js](https://github.com/mozilla/pdf.js) and [fflate](https://github.com/101arrowz/fflate)) are pinned and served from this site ([`vendor/`](vendor/VERSIONS.json)). CI checks that the vendored files are byte-identical to the pinned npm packages.
- **Automated proof:** the browser tests convert every sample file while recording all network traffic. They fail if anything other than the app's own static files is requested. Another test checks that the browser really blocks `fetch`, images, WebSockets and beacons to outside servers.
- **Check it yourself:** open the page, then DevTools → Network, and convert a file. You'll see no requests. Or turn on airplane mode after the first visit; it still works.
- **Honest caveats:**
  - The service worker and the pdf.js worker are separate scripts. Browsers don't apply the page's CSP to them, because GitHub Pages can't send HTTP headers. Both are short, open source, and only ever fetch this site's own files. The tests watch their traffic too.
  - When you use **Send to Kindle** (app, email or website), Amazon receives a copy and keeps it in your Kindle library. For the strictest confidentiality, copy the EPUB to the Kindle over USB with Calibre.
- The **in-browser reader** renders the book from memory. Manuscript text is inserted as plain text (never as HTML), so a file can't inject code. The only things saved on the device (`localStorage`) are display settings and reading positions. The manuscript itself is never stored: to read it again, open the file again.
- The repository contains **no manuscripts**, only synthetic test texts written for this project.

## Getting the EPUB onto a Kindle

| Method | How |
|---|---|
| Phone (easiest) | Convert on the phone, tap **Send to Kindle app…**, choose *Kindle*. On iPhone, if the button isn't offered, tap **Download EPUB**, open it in Files, then *Share → Kindle*. |
| Email | Send the `.epub` as an attachment to your *Send-to-Kindle* address (Amazon → Manage Your Content and Devices → Preferences → Personal Document Settings). Your sending address must be on the approved list. |
| Web | Drag the file onto https://www.amazon.com/sendtokindle |
| Calibre + USB (most private) | Install [Calibre](https://calibre-ebook.com), add the EPUB, plug in the Kindle, then *Send to device*. Calibre converts to the Kindle format on your computer. |

Kobo: copy the EPUB to the e-reader over USB (or use Dropbox/Google Drive in the Kobo menu). Apple Books: open the file on the iPhone/iPad/Mac.

Send to Kindle keeps highlights and notes in the Kindle library, synced across devices.

## When the result isn't right

- **Chapter titles garbled?** Some typeset PDFs use a title font whose letters can't be read. If the PDF has bookmarks, their titles are used automatically. Otherwise open **Chapters**, then use **Number them** (Chapter 1, 2, 3…) or **Edit titles**.
- **Chapters missing or wrong?** Use the **Chapter titles** menu. It lists the looks found in the manuscript, with how many chapters each gives and an example: a Word paragraph style, larger text, bold lines, CAPITALS, centred lines, lines starting with a number. When nothing is found automatically, the app already tries the most consistent of these and says so ("Automatic (found: bold lines)").
- **Words changed?** Tick **Keep the text exactly as written**. This turns off the typographic clean-up (curly quotes, `--` → —, spacing around punctuation, French no-break spaces). A hyphen at the end of a PDF line is then kept unless the joined word appears elsewhere in the book.
- **Still wrong? Send a problem report.** Tap *Something looks wrong? Send a privacy-safe problem report…*. The app makes a small `.zip` on the device in which every letter of the manuscript is replaced by `x` / `X`. What remains:
  - the layout: fonts, sizes, positions, Word styles
  - punctuation
  - chapter words such as "Capítulo"
  - very common words (de, la, the…), which are needed to reproduce language detection

  For Word files it includes an anonymized copy of the .docx. You can open it to check before sending. The developer replays it with `node scripts/replay-report.mjs report.zip` and turns the problem into a permanent test.

## Tips for the best result

- **Ask for the Word file whenever possible.** It contains the real structure (italics, chapters), while a PDF only contains positioned text.
- A PDF exported from Word works well. Scans don't (no text layer).
- After converting, open **Preview** and **Chapters** to check the result before downloading. If headers or page numbers slipped through, a warning says so.

## Development

No framework, no build step: plain HTML, CSS and ES modules. The conversion code in `src/core/` has no DOM dependency, so the exact same code runs in Node's test runner and in the browser.

```bash
npm ci
```

```bash
npm test
```

```bash
npx playwright install chromium && npm run test:e2e
```

```bash
npm run try -- ~/Desktop/some-manuscript.pdf
```

```bash
npm run epubcheck
```

```bash
npm run serve
```

In order, these: install the dev tools (Playwright, mammoth as a test oracle); run the unit and quality tests; run the browser tests; convert a real file locally and print a quality report (writes `out/*.epub`, never commit real manuscripts); validate `out/*.epub` with epubcheck 5.4.0 (needs Java); and serve the site at http://localhost:8080.

See [CLAUDE.md](CLAUDE.md) for the architecture and conventions, and [PLAN.md](PLAN.md) for the design rationale.

CI (GitHub Actions) runs every test plus epubcheck on every generated EPUB, then deploys to GitHub Pages on pushes to `main`. One-time setup: *Settings → Pages → Source: GitHub Actions*.

## Phase 2 (not built yet): the reading room

A shared space where manuscripts can be read without the file circulating:

- Agents and authors upload manuscripts. The publisher grants **per-person read access**, with an **expiry date** and **revocation**.
- Reading happens in a **web reader**, so no file leaves the platform.
- Trusted readers can optionally download a **personally watermarked EPUB** (name and date inside the text and metadata).
- An **audit log** shows who opened what, and when.

This needs a backend (accounts, storage, access control and logs), so it can't run on GitHub Pages. The likely stack is **Supabase in an EU region** (Postgres with row-level security, Storage with signed URLs, Auth with magic links, Edge Functions for watermarking), with the converter from this repo reused for ingestion.

## License

MIT. Vendored libraries keep their own licenses (`vendor/*/LICENSE`).
