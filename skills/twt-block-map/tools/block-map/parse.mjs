// parse.mjs — tolerant HTML tokenizer producing a generic node tree.
//
// Deliberately NOT the regex/balancedEnd approach used by ds-audit.mjs: that
// counts depth for ONE tag name at a time, which is fine for pulling flat
// top-level regions and wrong for building a tree. Real pages ship unclosed
// <li>/<p>, stray </div>, and markup inside <script> strings, so the tokenizer
// is forgiving by design — it never throws, it recovers.

const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const RAW = new Set(['script','style','textarea','title']);
// Tags that auto-close a previous sibling of the same name.
const SELF_CLOSING_SIBLING = new Set(['li','p','td','th','tr','option','dt','dd']);

// Producing text is the parser's job — every consumer (fingerprint's
// semantic flags, the Task 10 report renderer, anything else that reads
// `.text`) should see real characters, not raw markup entities. Named-entity
// table covers the common punctuation/whitespace entities real content uses;
// numeric entities (`&#NN;` / `&#xNN;`) are decoded generically below. `&amp;`
// is decoded LAST so an entity like `&amp;ldquo;` doesn't get double-decoded
// into a literal curly quote.
const NAMED_ENTITIES = {
  lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  mdash: '—', ndash: '–', hellip: '…',
};

// String.fromCodePoint throws RangeError outside 0..0x10FFFF (and for
// non-finite input) — a malformed or adversarial numeric entity like
// `&#x110000;` or `&#xFFFFFFFFFF;` must not abort parsing of an entire
// page (parser contract: "it never throws, it recovers" — see file header).
// Out-of-range code points are left as the raw, un-decoded entity text
// instead. Lone surrogates (e.g. `&#xD800;`) and `&#x0;` are within range
// and decode normally — only the numeric bound is checked here.
function isValidCodePoint(cp) {
  return Number.isFinite(cp) && cp >= 0 && cp <= 0x10FFFF;
}

function decodeEntities(s) {
  if (s.indexOf('&') === -1) return s;
  let out = s.replace(/&(lt|gt|quot|apos|nbsp|ldquo|rdquo|lsquo|rsquo|mdash|ndash|hellip);/g,
    (m, name) => NAMED_ENTITIES[name]);
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => {
    const cp = parseInt(hex, 16);
    return isValidCodePoint(cp) ? String.fromCodePoint(cp) : m;
  });
  out = out.replace(/&#(\d+);/g, (m, dec) => {
    const cp = parseInt(dec, 10);
    return isValidCodePoint(cp) ? String.fromCodePoint(cp) : m;
  });
  out = out.replace(/&amp;/g, '&');
  return out;
}

function attrsOf(s) {
  const attrs = {};
  const re = /([a-zA-Z_:][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(s))) attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return attrs;
}

function node(tag, attrs = {}) {
  const cls = (attrs.class || '').trim();
  return {
    tag,
    attrs,
    classes: cls ? cls.split(/\s+/) : [],
    id: attrs.id || '',
    children: [],
    text: '',
  };
}

export function parseHtml(html) {
  const root = node('#root');
  const stack = [root];
  const tokRe = /<!--[\s\S]*?-->|<\/([a-zA-Z][-\w]*)\s*>|<([a-zA-Z][-\w]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;
  let last = 0, m;

  const top = () => stack[stack.length - 1];
  // Decode BEFORE collapsing/trimming whitespace, not after: `&nbsp;` (and
  // any other whitespace-producing entity) decodes to a real space
  // character, and that character needs to go through the SAME collapse+
  // trim pass real whitespace does — otherwise "&nbsp;leading" keeps its
  // leading space past trim(), and "a&nbsp;&nbsp;&nbsp;b" keeps three
  // spaces instead of collapsing to one, because collapse/trim already
  // ran before the entity became a space character.
  const addText = (s) => {
    const t = decodeEntities(s).replace(/\s+/g, ' ').trim();
    if (t) top().text = (top().text ? top().text + ' ' : '') + t;
  };

  while ((m = tokRe.exec(html))) {
    addText(html.slice(last, m.index));
    last = tokRe.lastIndex;

    if (m[0].startsWith('<!--')) continue;

    if (m[1]) {                                   // closing tag
      const name = m[1].toLowerCase();
      // Unwind to the nearest matching open tag; ignore strays entirely.
      const at = stack.map((n) => n.tag).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }

    const tag = m[2].toLowerCase();
    const el = node(tag, attrsOf(m[3] || ''));

    if (SELF_CLOSING_SIBLING.has(tag) && top().tag === tag) stack.pop();

    top().children.push(el);

    if (VOID.has(tag) || m[4] === '/') continue;

    if (RAW.has(tag)) {                           // skip raw text wholesale
      const close = html.toLowerCase().indexOf('</' + tag, tokRe.lastIndex);
      if (close === -1) {
        // No closing tag before EOF: an unterminated <script>/<style>/
        // <textarea>/<title> must not swallow the rest of the document
        // (e.g. a truncated HTTP response). Treat it as having no raw
        // content and resume normal tokenizing right after the opening
        // tag — `last` is already tokRe.lastIndex from above.
        continue;
      }
      const end = close;
      // Same decode-then-collapse-then-trim order as addText, above — a
      // title bypassing decodeEntities entirely would leave literal
      // "&ldquo;" etc. in page titles for every downstream consumer.
      el.text = tag === 'title' ? decodeEntities(html.slice(tokRe.lastIndex, end)).replace(/\s+/g, ' ').trim() : '';
      tokRe.lastIndex = end;
      last = end;
      continue;
    }

    stack.push(el);
  }
  addText(html.slice(last));
  return root;
}
