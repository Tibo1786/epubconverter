# -*- coding: utf-8 -*-
"""Generate the test corpus in test/fixtures/.

    python3 test/fixtures/src/make_fixtures.py

Needs python-docx, reportlab, LibreOffice (soffice) and poppler (pdftoppm).
The generated files are committed, so CI does not need these tools.

Each fixture <name>.<ext> gets a ground-truth <name>.expected.json describing
what an ideal conversion contains: metadata, chapter titles and every block
(paragraph text with *italic* / **bold** markers, or "<scene>").
"""
import copy
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import corpus  # noqa: E402

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

# ---------------------------------------------------------------- markup ----

RUN_RE = re.compile(r"(\*\*[^*]+\*\*|\*[^*]+\*)")


def runs_of(text):
    """'a *b* **c**' -> [('a ', False, False), ('b', True, False), ...]"""
    out = []
    for part in RUN_RE.split(text):
        if not part:
            continue
        if part.startswith("**"):
            out.append((part[2:-2], False, True))
        elif part.startswith("*"):
            out.append((part[1:-1], True, False))
        else:
            out.append((part, False, False))
    return out


def curlify(s):
    """Reference implementation of the typography the converter must apply."""
    s = s.replace("--", "—")
    s = re.sub(r"(^|[\s(\[{—])\"", lambda m: m.group(1) + "“", s)
    s = s.replace('"', "”")
    s = re.sub(r"(^|[\s(\[{—])'", lambda m: m.group(1) + "‘", s)
    s = s.replace("'", "’")
    return s


def chapter_title(parts):
    if len(parts) == 1:
        return parts[0]
    first = parts[0]
    sep = " " if first[-1] in ".:;—" else ". "
    return first + sep + parts[1]


def expected_for(book, extra=None):
    chapters = []
    for ch in book["chapters"]:
        blocks = []
        for b in ch["blocks"]:
            if isinstance(b, dict):
                blocks.append("<scene>")
            else:
                blocks.append(curlify(b))
        c = {"title": curlify(chapter_title(ch["heading"])), "blocks": blocks}
        if ch.get("lang"):
            c["lang"] = ch["lang"]
        chapters.append(c)
    exp = {
        "title": book["title"],
        "author": book["author"],
        "lang": book["lang"],
        "chapters": chapters,
        # Strings that must never appear in the body (running headers etc.)
        "forbidden": [],
    }
    if extra:
        exp.update(extra)
    return exp


def write_json(name, data):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


# ----------------------------------------------------------- hyphenation ----

VOWELS = set("aeiouáéíóúàèìòùäëïöüâêîôûy")
INSEPARABLE = {"ll", "rr", "ch", "qu", "gu", "ny", "ph", "th", "sh"}


def hyphen_points(word):
    """Very small syllable splitter (V-CV, VC-CV, keeps clusters like 'pr',
    'bl', 'll'). Returns split indexes. Catalan l·l splits at the middle dot."""
    points = []
    w = word.lower()
    n = len(w)
    for i in range(2, n - 2):
        if w[i] == "·" or w[i - 1] == "·":
            continue
        a, b = w[i - 1], w[i]
        if not (a.isalpha() and b.isalpha()):
            continue
        if b not in VOWELS and i + 1 < n and w[i + 1] in VOWELS and a in VOWELS:
            points.append(i)  # V-CV
        elif a not in VOWELS and b not in VOWELS and i + 1 < n and w[i + 1] in VOWELS:
            pair = a + b
            if pair in INSEPARABLE or (b in "lr" and a in "bcdfgkpt"):
                continue
            if i - 2 >= 0 and w[i - 2] in VOWELS:
                points.append(i)  # VC-CV
    for m in re.finditer("l·l", w):
        points.append(m.start() + 2)  # col·|lecció  (special: drop the dot)
    return sorted(p for p in points if 2 <= p <= n - 3)


def shy(text):
    """Insert soft hyphens into long words (for the LibreOffice PDF)."""
    def rep(m):
        word = m.group(0)
        if len(word) < 9 or "·" in word:
            return word
        pts = hyphen_points(word)
        out, last = [], 0
        for p in pts:
            out.append(word[last:p])
            last = p
        out.append(word[last:])
        return "­".join(out)
    return re.sub(r"[A-Za-zÀ-ÿ·]+", rep, text)


# ------------------------------------------------------------------ DOCX ----

def set_cell_props(paragraph, *, align=None, indent=None, before=None, after=None,
                   page_break=False, keep_next=False):
    pf = paragraph.paragraph_format
    if align is not None:
        paragraph.alignment = align
    if indent is not None:
        pf.first_line_indent = indent
    if before is not None:
        pf.space_before = before
    if after is not None:
        pf.space_after = after
    if page_break:
        pf.page_break_before = True
    if keep_next:
        pf.keep_with_next = True


def add_field(paragraph, instr):
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), instr)
    r = OxmlElement("w:r")
    t = OxmlElement("w:t")
    t.text = "1"
    r.append(t)
    fld.append(r)
    paragraph._p.append(fld)


def add_runs(paragraph, text, *, emphasis_style=False, tracked=False, soft=False):
    """Add marked-up text. Extra docx-only markup:
       {+ins+} tracked insertion, {-del-} tracked deletion, {shy} soft hyphen."""
    for seg, italic, bold in runs_of(text):
        pieces = re.split(r"(\{\+.*?\+\}|\{-.*?-\}|\{shy\})", seg)
        for piece in pieces:
            if not piece:
                continue
            if piece == "{shy}":
                r = paragraph.add_run()
                r._r.append(OxmlElement("w:softHyphen"))
                continue
            if piece.startswith("{+"):
                wrap = OxmlElement("w:ins")
                body = piece[2:-2]
            elif piece.startswith("{-"):
                wrap = OxmlElement("w:del")
                body = piece[2:-2]
            else:
                wrap = None
                body = piece
            if soft:
                body = shy(body)
            r = paragraph.add_run(body)
            if italic:
                if emphasis_style:
                    r.style = "Emphasis"
                else:
                    r.italic = True
            if bold:
                r.bold = True
            if wrap is not None:
                wrap.set(qn("w:id"), str(abs(hash(body)) % 10000))
                wrap.set(qn("w:author"), "Editor")
                wrap.set(qn("w:date"), "2026-10-01T10:00:00Z")
                if wrap.tag == qn("w:del"):
                    for t in r._r.findall(qn("w:t")):
                        t.tag = qn("w:delText")
                r._r.addprevious(wrap)
                wrap.append(r._r)


def add_footnotes_part(doc, text):
    """python-docx has no footnote API: add word/footnotes.xml by hand."""
    xml = (
        f'<w:footnotes xmlns:w="{W_NS}">'
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
        '<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>'
        '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>'
        f'<w:r><w:t xml:space="preserve"> {text}</w:t></w:r></w:p></w:footnote>'
        "</w:footnotes>"
    )
    part = Part(
        PackURI("/word/footnotes.xml"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml",
        xml.encode("utf-8"),
        doc.part.package,
    )
    doc.part.relate_to(part, RT.FOOTNOTES)


def add_footnote_ref(paragraph):
    r = paragraph.add_run()
    rpr = OxmlElement("w:rPr")
    va = OxmlElement("w:vertAlign")
    va.set(qn("w:val"), "superscript")
    rpr.append(va)
    r._r.append(rpr)
    ref = OxmlElement("w:footnoteReference")
    ref.set(qn("w:id"), "1")
    r._r.append(ref)


def build_docx(book, path, *, variant, layout="manuscript"):
    """variant 'full': the DOCX fixture (tracked changes, footnote, soft hyphen,
    style-inherited italics). variant 'pdf': same text with all changes
    accepted and soft hyphens in long words, to be exported to PDF."""
    doc = Document()
    st = doc.styles["Normal"]
    st.font.name = "Times New Roman"
    st.font.size = Pt(12)
    rpr = st.element.get_or_add_rPr()
    lang = OxmlElement("w:lang")
    lang.set(qn("w:val"), {"es": "es-ES", "ca": "ca-ES", "en": "en-GB", "fr": "fr-FR"}[book["lang"]])
    rpr.append(lang)
    pf = st.paragraph_format
    if layout == "block":
        # Another common habit: 1.5 spacing, ragged right, no indent,
        # space between paragraphs, a sans font.
        st.font.name = "Carlito"
        st.font.size = Pt(11)
        pf.line_spacing = 1.5
        pf.first_line_indent = Cm(0)
        pf.space_after = Pt(10)
        pf.alignment = WD_ALIGN_PARAGRAPH.LEFT
    else:
        pf.line_spacing_rule = WD_LINE_SPACING.DOUBLE
        pf.first_line_indent = Cm(1.25)
        pf.space_after = Pt(0)
        pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    for hn, size in (("Heading 1", 20), ("Heading 2", 14)):
        h = doc.styles[hn]
        h.font.name = "Times New Roman"
        h.font.size = Pt(size)
        h.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
        h.paragraph_format.first_line_indent = Cm(0)
    doc.styles["Heading 1"].paragraph_format.page_break_before = True
    doc.styles["Heading 1"].paragraph_format.space_before = Pt(96)
    doc.styles["Heading 2"].font.italic = True
    from docx.enum.style import WD_STYLE_TYPE
    fst = doc.styles.add_style("footnote text", WD_STYLE_TYPE.PARAGRAPH)
    fst.element.set(qn("w:styleId"), "FootnoteText")
    fst.base_style = st
    fst.font.size = Pt(10)
    fst.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
    fst.paragraph_format.first_line_indent = Cm(0)

    sec = doc.sections[0]
    sec.page_height, sec.page_width = Cm(29.7), Cm(21.0)
    sec.left_margin = sec.right_margin = Cm(2.5)
    sec.top_margin = sec.bottom_margin = Cm(2.5)
    sec.different_first_page_header_footer = True
    if layout == "block":
        # single header: "Title — Author    Página N de M", no footer
        hp = sec.header.paragraphs[0]
        hp.text = f"{book['title']} — {book['author']}\tPágina "
        add_field(hp, "PAGE")
        hp.add_run(" de ")
        add_field(hp, "NUMPAGES")
        hp.runs[0].italic = True
        cp = doc.core_properties
        cp.title, cp.author = book["title"], book["author"]
        return _body(doc, book, path, variant)
    doc.settings.odd_and_even_pages_header_footer = True
    hp = sec.header.paragraphs[0]
    hp.text = book["title"]
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    hp.runs[0].italic = True
    ep = sec.even_page_header.paragraphs[0]
    ep.text = book["author"]
    ep.alignment = WD_ALIGN_PARAGRAPH.LEFT
    ep.runs[0].italic = True
    for footer in (sec.footer, sec.even_page_footer):
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        add_field(fp, "PAGE")

    cp = doc.core_properties
    cp.title, cp.author = book["title"], book["author"]
    return _body(doc, book, path, variant)


def _body(doc, book, path, variant):
    # Front matter, as typed in many manuscripts.
    t = doc.add_paragraph(book["title"], style="Title")
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    t.paragraph_format.space_before = Pt(180)
    a = doc.add_paragraph(book["author"])
    set_cell_props(a, align=WD_ALIGN_PARAGRAPH.CENTER, indent=Cm(0))

    full = variant == "full"
    fn = book.get("footnote")
    if fn:
        add_footnotes_part(doc, fn["text"])

    for ci, ch in enumerate(book["chapters"]):
        head = ch["heading"]
        if ch.get("kind", "style") == "style":
            doc.add_paragraph(head[0], style="Heading 1")
            if len(head) > 1:
                doc.add_paragraph(head[1], style="Heading 2")
        else:
            p = doc.add_paragraph()
            set_cell_props(p, align=WD_ALIGN_PARAGRAPH.CENTER, indent=Cm(0),
                           before=Pt(96), page_break=True, keep_next=True)
            r = p.add_run(head[0])
            r.bold, r.font.size = True, Pt(16)
            if len(head) > 1:
                p = doc.add_paragraph()
                set_cell_props(p, align=WD_ALIGN_PARAGRAPH.CENTER, indent=Cm(0),
                               after=Pt(24), keep_next=True)
                r = p.add_run(head[1])
                r.italic, r.font.size = True, Pt(14)
        for bi, block in enumerate(ch["blocks"]):
            if isinstance(block, dict):
                p = doc.add_paragraph(block["break"])
                set_cell_props(p, align=WD_ALIGN_PARAGRAPH.CENTER, indent=Cm(0))
                continue
            text = block
            if full and ci == 0 and bi == 3:
                text = text.replace("calles estrechas", "calles {-muy -}{+estrechas+}")
            if full and "extraordinariamente" in text:
                text = text.replace("extraordinariamente", "extraordinaria{shy}mente")
            p = doc.add_paragraph()
            emphasis = full and ci == 1  # chapter 2 uses the Emphasis char style
            if fn and ci == fn["chapter"] and bi == fn["block"]:
                before, after = text.split(fn["after"], 1)
                add_runs(p, before + fn["after"], emphasis_style=emphasis, tracked=full, soft=not full)
                add_footnote_ref(p)
                add_runs(p, after, emphasis_style=emphasis, tracked=full, soft=not full)
            else:
                add_runs(p, text, emphasis_style=emphasis, tracked=full, soft=not full)
    doc.save(path)


def soffice_pdf(docx_path, out_pdf):
    tmp = tempfile.mkdtemp()
    subprocess.run(
        ["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmp, docx_path],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    produced = os.path.join(tmp, os.path.splitext(os.path.basename(docx_path))[0] + ".pdf")
    shutil.move(produced, out_pdf)
    shutil.rmtree(tmp, ignore_errors=True)


# ------------------------------------------- hand-typeset PDF (reportlab) ----

def typeset_pdf(book, path, *, style):
    """A small typesetter on reportlab: justified lines, real hyphenation
    (including Catalan l·l -> 'l-' / 'l'), running headers, page numbers.
    style 'ca': indented paragraphs, Tw-justified text, header alternates.
    style 'fr': block paragraphs, every word drawn separately (no space
    characters in the PDF), page numbers like '– 12 –'."""
    from reportlab.lib.pagesizes import A5
    from reportlab.pdfbase.pdfmetrics import stringWidth
    from reportlab.pdfgen import canvas

    W, H = A5
    ml, mr, mt, mb = 52, 52, 60, 62
    width = W - ml - mr
    size, lead = 10.5, 14
    fonts = {(False, False): "Times-Roman", (True, False): "Times-Italic",
             (False, True): "Times-Bold", (True, True): "Times-BoldItalic"}
    c = canvas.Canvas(path, pagesize=A5)
    c.setTitle(book["title"])
    c.setAuthor(book["author"])
    state = {"page": 0, "y": None}

    def new_page(header=True):
        if state["page"]:
            c.showPage()
        state["page"] += 1
        n = state["page"]
        if header and n > 1:
            c.setFont("Times-Italic", 8.5)
            if style == "fr":
                c.drawCentredString(W / 2, H - 34, f"{book['author']} — {book['title']}")
                c.setFont("Times-Roman", 9)
                c.drawCentredString(W / 2, 30, f"– {n} –")
            else:
                txt = book["title"] if n % 2 else book["author"].upper()
                c.drawCentredString(W / 2, H - 34, txt)
                c.setFont("Times-Roman", 9)
                (c.drawRightString if n % 2 else c.drawString)(W - mr if n % 2 else ml, 30, str(n))
        state["y"] = H - mt

    def words_of(text):
        """Tokens (word, italic, bold, glue_before). French punctuation that
        must not start a line is glued to the previous word."""
        toks = []
        pending_ws = False
        for seg, it, bd in runs_of(text):
            for m in re.finditer(r"(\s*)(\S+)", seg):
                toks.append([m.group(2), it, bd, bool(m.group(1)) or pending_ws])
                pending_ws = False
            pending_ws = bool(seg) and seg[-1].isspace()
        # tokens without leading whitespace that follow another token are
        # glued (e.g. italic run directly after a roman one)
        out = []
        for i, (w, it, bd, ws) in enumerate(toks):
            glue = i > 0 and not ws
            if style == "fr" and ws and (w in ("?", "!", ":", ";", "»") or (out and out[-1][0] == "«")):
                glue = "space"  # non-breaking space
            out.append([w, it, bd, glue])
        return out

    def wwidth(w, it, bd):
        return stringWidth(w, fonts[(it, bd)], size)

    def emit_line(items, x0, avail, justify):
        """items: list of (text, it, bd, space_before)"""
        natural = sum(wwidth(t, i, b) for t, i, b, _ in items)
        spaces = sum(1 for *_, sp in items if sp)
        sw = stringWidth(" ", "Times-Roman", size)
        extra = 0.0
        if justify and spaces:
            extra = (avail - natural - spaces * sw) / spaces
        y = state["y"]
        if style == "fr":
            x = x0
            for t, i, b, sp in items:
                if sp:
                    x += sw + extra
                c.setFont(fonts[(i, b)], size)
                c.drawString(x, y, t)
                x += wwidth(t, i, b)
        else:
            to = c.beginText(x0, y)
            to.setWordSpace(extra if justify else 0)
            for t, i, b, sp in items:
                to.setFont(fonts[(i, b)], size)
                to.textOut((" " if sp else "") + t)
            c.drawText(to)
        state["y"] -= lead

    def ensure_space(lines=1):
        if state["y"] - lines * lead < mb:
            new_page()

    def paragraph(text, indent):
        toks = words_of(text)
        line, lw = [], 0.0
        first = True
        sw = stringWidth(" ", "Times-Roman", size)
        i = 0
        while i < len(toks):
            w, it, bd, glue = toks[i]
            avail = width - (indent if first else 0)
            sp = bool(line) and glue is not True
            ww = wwidth(w, it, bd) + (sw if sp else 0)
            # Typesetter's choice: break Catalan l·l words near the line end
            # even when they would fit, so the corpus exercises 'col-'/'lecció'.
            m_ll = re.match(r"^([A-Za-zÀ-ÿ]+·)(l[A-Za-zÀ-ÿ]+\W*)$", w)
            if (m_ll and line and lw > avail * 0.72 and glue is not True
                    and lw + sw + wwidth(m_ll.group(1)[:-1] + "-", it, bd) <= avail):
                line.append((m_ll.group(1)[:-1] + "-", it, bd, True))
                ensure_space()
                emit_line(line, ml + (indent if first else 0), avail, justify=True)
                first = False
                line, lw = [(m_ll.group(2), it, bd, False)], wwidth(m_ll.group(2), it, bd)
                i += 1
                continue
            if lw + ww <= avail or not line:
                line.append((w, it, bd, sp))
                lw += ww
                i += 1
                continue
            # does not fit: try to hyphenate this word (not glued punctuation)
            placed = False
            core = re.match(r"^([«“(]*)([A-Za-zÀ-ÿ·]+)(.*)$", w)
            if core and glue is not True and glue != "space":
                pre, letters, post = core.groups()
                pts = hyphen_points(letters)
                ll = [p for p in pts if letters[p - 1] == "·"]
                if ll:
                    pts = ll  # prefer the Catalan l·l split so the corpus exercises it
                for p in reversed(pts):
                    head = pre + letters[:p]
                    tail = letters[p:] + post
                    if head.endswith("·"):
                        head = head[:-1]  # Catalan: col·lecció -> col- / lecció
                    if lw + sw + wwidth(head + "-", it, bd) <= avail:
                        line.append((head + "-", it, bd, True))
                        toks[i] = [tail, it, bd, False]
                        placed = True
                        break
            ensure_space()
            emit_line(line, ml + (indent if first else 0), avail, justify=True)
            first = False
            line, lw = [], 0.0
            if placed:
                # tail starts the next line
                w, it, bd, _ = toks[i]
                line.append((w, it, bd, False))
                lw = wwidth(w, it, bd)
                i += 1
        if line:
            ensure_space()
            emit_line(line, ml + (indent if first else 0), width, justify=False)

    # title page
    new_page(header=False)
    c.setFont("Times-Bold", 22)
    c.drawCentredString(W / 2, H * 0.62, book["title"])
    c.setFont("Times-Roman", 13)
    c.drawCentredString(W / 2, H * 0.62 - 34, book["author"])

    for ch in book["chapters"]:
        new_page()
        state["y"] = H * 0.70
        c.setFont("Times-Bold", 17)
        c.drawCentredString(W / 2, state["y"], ch["heading"][0])
        state["y"] -= 24
        if len(ch["heading"]) > 1:
            c.setFont("Times-Italic", 13)
            c.drawCentredString(W / 2, state["y"], ch["heading"][1])
            state["y"] -= 20
        state["y"] -= 26
        for b in ch["blocks"]:
            if isinstance(b, dict):
                ensure_space(3)
                state["y"] -= lead * 0.6
                c.setFont("Times-Roman", size)
                c.drawCentredString(W / 2, state["y"], b["break"])
                state["y"] -= lead * 1.6
                continue
            if style == "fr":
                paragraph(b, 0)
                state["y"] -= lead * 0.55
            else:
                paragraph(b, 16)
    c.showPage()
    c.save()


# ------------------------------------------------------------- scanned PDF --

def scanned_pdf(src_pdf, out_pdf):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    tmp = tempfile.mkdtemp()
    subprocess.run(["pdftoppm", "-r", "60", "-gray", "-png", "-f", "2", "-l", "4",
                    src_pdf, os.path.join(tmp, "p")], check=True)
    c = canvas.Canvas(out_pdf, pagesize=A4)
    c.setTitle("scan")
    for f in sorted(os.listdir(tmp)):
        c.drawImage(os.path.join(tmp, f), 0, 0, width=A4[0], height=A4[1])
        c.showPage()
    c.save()
    shutil.rmtree(tmp, ignore_errors=True)


# --------------------------------------------------------------------- TXT --

def build_txt(book, path):
    import textwrap
    lines = [book["title"], "by " + book["author"], "", ""]
    for ch in book["chapters"]:
        lines += ["", ch["heading"][0], ""]
        for b in ch["blocks"]:
            if isinstance(b, dict):
                lines += ["            " + b["break"], ""]
            else:
                plain = re.sub(r"\*+([^*]+)\*+", r"_\1_", b)
                lines += textwrap.wrap(plain, 70) + [""]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


# -------------------------------------------------------------------- main --

def main():
    es = corpus.NOVEL_ES
    tmp = tempfile.mkdtemp()

    # 1. Spanish novel DOCX (+ its own PDF export through LibreOffice)
    build_docx(es, os.path.join(OUT, "novel-es.docx"), variant="full")
    pdf_src = os.path.join(tmp, "novel-es.docx")
    build_docx(es, pdf_src, variant="pdf")
    soffice_pdf(pdf_src, os.path.join(OUT, "novel-es.pdf"))
    fn = es["footnote"]
    write_json("novel-es.docx.expected.json",
               expected_for(es, {"notes": [fn["text"]], "forbidden": []}))
    write_json("novel-es.pdf.expected.json",
               expected_for(es, {"notes": [fn["text"]],
                                 "forbidden": ["Marta Vidal", "La casa de los relojes"]}))

    # 1b. Same novel, another layout habit (block paragraphs, ragged right)
    pdf_src = os.path.join(tmp, "novel-es-block.docx")
    build_docx(es, pdf_src, variant="pdf", layout="block")
    soffice_pdf(pdf_src, os.path.join(OUT, "novel-es-block.pdf"))
    write_json("novel-es-block.pdf.expected.json",
               expected_for(es, {"notes": [fn["text"]],
                                 "forbidden": ["Marta Vidal", "Página"]}))

    # 2. Bilingual Catalan/English: DOCX and a hand-typeset PDF
    ca = corpus.BILINGUAL_CA_EN
    build_docx(ca, os.path.join(OUT, "bilingual-ca-en.docx"), variant="full")
    write_json("bilingual-ca-en.docx.expected.json", expected_for(ca))
    pdf_src = os.path.join(tmp, "bilingual-ca-en-lo.docx")
    build_docx(ca, pdf_src, variant="pdf")
    soffice_pdf(pdf_src, os.path.join(OUT, "bilingual-ca-en-lo.pdf"))
    write_json("bilingual-ca-en-lo.pdf.expected.json",
               expected_for(ca, {"forbidden": ["Jordi Pujol i Serra"]}))
    typeset_pdf(ca, os.path.join(OUT, "bilingual-ca-en.pdf"), style="ca")
    write_json("bilingual-ca-en.pdf.expected.json",
               expected_for(ca, {"forbidden": ["JORDI PUJOL", "El far de les col·leccions"]}))

    # 3. French novel, different PDF producer and layout
    fr = corpus.NOVEL_FR
    typeset_pdf(fr, os.path.join(OUT, "novel-fr.pdf"), style="fr")
    write_json("novel-fr.pdf.expected.json",
               expected_for(fr, {"forbidden": ["Hélène Marchetti", "– 3 –"]}))

    # 4. Plain text, hard-wrapped, straight quotes, -- dashes, _italics_
    en = corpus.PLAIN_EN
    build_txt(en, os.path.join(OUT, "plain-en.txt"))
    exp = expected_for(en)
    write_json("plain-en.txt.expected.json", exp)

    # 5. Scanned PDF: images only, no text layer
    scanned_pdf(os.path.join(OUT, "novel-es.pdf"), os.path.join(OUT, "scanned.pdf"))
    write_json("scanned.pdf.expected.json", {"scanned": True})

    shutil.rmtree(tmp, ignore_errors=True)
    print("fixtures written to", OUT)


if __name__ == "__main__":
    main()
