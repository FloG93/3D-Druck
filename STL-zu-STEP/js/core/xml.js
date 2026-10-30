// A small XML scanner for the files inside a 3MF archive. DOMParser is not
// available in a worker and not in Node, and the files are regular: elements
// with attributes, a little text in <metadata>. It reports open tags, close
// tags and text; comments, processing instructions and CDATA are understood.
// Not a validating parser – a file that is not XML just yields no elements.

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!(?:DOCTYPE|ENTITY)[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** &amp; &lt; &#65; &#x41; … in a text or an attribute value. */
export function decodeEntities(text) {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

const attributePatterns = new Map();

/**
 * The value of one attribute from the raw attribute text of a tag, or
 * undefined. Looked up on demand: a mesh has millions of <vertex/> and
 * <triangle/> tags, and most of them need three of their attributes at most.
 */
export function attr(raw, name) {
  let pattern = attributePatterns.get(name);
  if (!pattern) {
    pattern = new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
    attributePatterns.set(name, pattern);
  }
  const m = pattern.exec(raw);
  if (!m) return undefined;
  return decodeEntities(m[1] ?? m[2]);
}

/**
 * scanXml(text, { open(name, raw, selfClosing), close(name), text(string) })
 * `raw` is the attribute text; read values with attr(raw, 'name'). A
 * self-closing tag calls open and then close.
 */
export function scanXml(text, handlers) {
  TOKEN.lastIndex = 0;
  let last = 0;
  let m;
  while ((m = TOKEN.exec(text)) !== null) {
    if (handlers.text && m.index > last) {
      const between = text.slice(last, m.index);
      if (between.trim() !== '') handlers.text(decodeEntities(between));
    }
    last = TOKEN.lastIndex;
    if (m[1] !== undefined && m[0].startsWith('<![CDATA[')) {
      handlers.text?.(m[1]);
    } else if (m[3] !== undefined) {
      const name = m[3];
      if (m[2] === '/') {
        handlers.close?.(name);
      } else {
        const selfClosing = m[5] === '/';
        handlers.open?.(name, m[4], selfClosing);
        if (selfClosing) handlers.close?.(name);
      }
    }
  }
}
