// Minimal, dependency-free XML reader for OOXML parts.
// Works the same in Node and in browsers (no DOMParser), which lets the whole
// converter run under Node's test runner.
//
// Element names are canonicalised by namespace URI, so "w:p" means the
// WordprocessingML paragraph whatever prefix the producer used (Transitional
// or Strict OOXML).

const NS = {
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'w',
  'http://purl.oclc.org/ooxml/wordprocessingml/main': 'w',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r',
  'http://purl.oclc.org/ooxml/officeDocument/relationships': 'r',
  'http://schemas.openxmlformats.org/package/2006/relationships': 'pr',
  'http://schemas.openxmlformats.org/markup-compatibility/2006': 'mc',
  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties': 'cp',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://purl.org/dc/terms/': 'dcterms',
};

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return ''; }
    }
    return ENTITIES[e] ?? m;
  });
}

class Element {
  constructor(name, attrs, parent) {
    this.name = name;
    this.attrs = attrs;
    this.children = [];
    this.parent = parent;
  }
  /** Concatenated text of all descendant text nodes. */
  get text() {
    let s = '';
    for (const c of this.children) s += typeof c === 'string' ? c : c.text;
    return s;
  }
  get elements() {
    return this.children.filter((c) => typeof c !== 'string');
  }
  child(name) {
    for (const c of this.children) if (typeof c !== 'string' && c.name === name) return c;
    return null;
  }
  childrenNamed(name) {
    return this.children.filter((c) => typeof c !== 'string' && c.name === name);
  }
  /** Depth-first search for descendants with the given name. */
  findAll(name, out = []) {
    for (const c of this.children) {
      if (typeof c === 'string') continue;
      if (c.name === name) out.push(c);
      c.findAll(name, out);
    }
    return out;
  }
  attr(name) {
    return this.attrs[name];
  }
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Parse an XML string into a lightweight tree. Whitespace-only text nodes are
 * kept only inside elements whose name is in `keepSpaceIn` (e.g. w:t).
 */
export function parseXml(xml) {
  const root = new Element('#document', {}, null);
  let cur = root;
  // stack of prefix->canonical maps
  let nsStack = [{ xml: 'xml' }];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(xml))) {
    if (m[6] !== undefined) {
      const t = m[6];
      if (cur !== root && (t.trim() !== '' || cur.name === 'w:t' || cur.name === 'w:delText' || cur.name === 'w:instrText')) {
        cur.children.push(decodeEntities(t));
      }
    } else if (m[1] !== undefined) {
      cur.children.push(m[1]);
    } else if (m[3] !== undefined) {
      const rawAttrs = {};
      const map = Object.create(nsStack[nsStack.length - 1]);
      let a;
      ATTR.lastIndex = 0;
      while ((a = ATTR.exec(m[4]))) {
        const key = a[1];
        const val = decodeEntities(a[2] ?? a[3] ?? '');
        if (key === 'xmlns') map[''] = NS[val] ?? '';
        else if (key.startsWith('xmlns:')) map[key.slice(6)] = NS[val] ?? key.slice(6);
        else rawAttrs[key] = val;
      }
      const canon = (qname) => {
        const i = qname.indexOf(':');
        if (i === -1) return map[''] ? `${map['']}:${qname}` : qname;
        const p = map[qname.slice(0, i)];
        return `${p ?? qname.slice(0, i)}:${qname.slice(i + 1)}`;
      };
      const attrs = {};
      for (const k in rawAttrs) attrs[k.includes(':') ? canon(k) : k] = rawAttrs[k];
      const el = new Element(canon(m[3]), attrs, cur);
      cur.children.push(el);
      if (m[5] !== '/') {
        cur = el;
        nsStack.push(map);
      }
    } else if (m[2] !== undefined) {
      if (cur.parent) {
        cur = cur.parent;
        nsStack.pop();
      }
    }
  }
  return root;
}
