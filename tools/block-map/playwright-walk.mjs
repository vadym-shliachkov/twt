// playwright-walk.mjs — the real-DOM engine.
//
// Returns EXACTLY the shape parse.mjs returns, so extract.mjs cannot tell
// which engine produced its input. The DOM is serialized inside the browser
// and crosses back as one plain object; it never reaches model context.
'use strict';
import { loadPlaywright } from '../lib/resolve-playwright.mjs';

// Tags dropped from the walked tree entirely — NOT the same thing parse.mjs
// does with the same tag names, just harmless enough that the difference
// never reaches extract.mjs's output. parse.mjs still emits a node for
// link/meta (VOID — empty children, no text) and script/style (RAW — empty
// children, no text): the NODE exists, it is just always childless. This
// walker drops all five tags before a node is ever created for them, so the
// parent's `children` array is shorter under Playwright than under the
// static engine for the same page. That is a real shape difference on the
// raw tree — it is invisible only because extract.mjs's own SKIP set
// (script/style/link/meta/head/title/br/#root) re-filters every one of
// these tags again on its own, recursively, regardless of which engine
// produced the tree, so no qualifying block's atoms/children ever depend on
// whether the dropped node was "absent" or "present but empty". `noscript`
// is dropped for a further, browser-specific reason parse.mjs never has to
// deal with: Playwright runs with scripting ENABLED, and per the HTML
// parsing spec that means a browser parses <noscript>'s content as opaque
// RAWTEXT (a single literal text blob, not child elements) — walking it
// "normally" would hand back a node whose one text child is unparsed markup
// source, which is a worse and far more misleading shape mismatch than
// dropping it outright. parse.mjs, by contrast, has no scripting flag and
// parses noscript's content as ordinary child elements. This is a known,
// accepted divergence: a page whose only content lives inside <noscript>
// fallback markup will report fewer blocks under the Playwright engine than
// the static one. See the task-11 report for the probe that confirmed this.
const ATOM_LIKE = ['script', 'style', 'link', 'meta', 'noscript'];

// RAW tags (parse.mjs's RAW set) other than <title> always get `text: ''`
// in parse.mjs — their content is skipped wholesale, never tokenized — even
// though a real <textarea>'s default value is ordinary decoded text in the
// DOM. Without forcing this, a fixture with `<textarea>hello</textarea>`
// would walk to `text: 'hello'` under Playwright but `text: ''` under the
// static parser, and the cross-engine shape test would fail on that page
// even though nothing about the VISIBLE block structure actually differs.
const FORCE_EMPTY_TEXT = new Set(['script', 'style', 'textarea']);

export async function walkWithPlaywright(url, { timeout = 20000 } = {}) {
  const { pw } = await loadPlaywright();
  if (!pw) return null;
  let browser;
  try {
    browser = await pw.chromium.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout });
    return await page.evaluate(({ skip, forceEmptyText }) => {
      // Own DIRECT text only — matches parse.mjs's addText: every direct
      // text run is entity-decoded (free here — textContent is already
      // decoded), whitespace-collapsed, and trimmed INDIVIDUALLY, then
      // non-empty runs are joined with a single space. Doing this per-chunk
      // (not on the concatenation of all chunks) matters: parse.mjs never
      // lets an empty run contribute a stray separating space, and it never
      // preserves an interior run of internal whitespace (newlines/tabs from
      // indented source) the way a bare per-node `.trim()` would.
      const ownText = (el) => [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ');

      const walk = (el) => {
        const tag = el.tagName.toLowerCase();
        const attrs = {};
        for (const a of el.attributes) attrs[a.name.toLowerCase()] = a.value;
        // <template>'s content is never in el.children — the HTML parser
        // diverts it into a separate `.content` DocumentFragment (that's
        // what keeps a template inert). parse.mjs has no such content-model
        // special case: its tokenizer treats <template> as an ordinary
        // container tag and walks straight through to whatever is inside.
        // Reading .content.children here (instead of .children) is what
        // keeps the two engines agreeing on a page that uses <template> —
        // without it, every node nested inside a template silently
        // vanishes from the Playwright tree only.
        const kidSource = tag === 'template' ? [...el.content.children] : [...el.children];
        return {
          tag,
          attrs,
          classes: [...el.classList],
          id: el.id || '',
          text: forceEmptyText.includes(tag) ? '' : ownText(el),
          children: kidSource
            .filter((c) => !skip.includes(c.tagName.toLowerCase()))
            .map(walk),
        };
      };

      return { tag: '#root', attrs: {}, classes: [], id: '', text: '', children: [walk(document.documentElement)] };
    }, { skip: ATOM_LIKE, forceEmptyText: [...FORCE_EMPTY_TEXT] });
  } catch {
    return null;                       // never let a browser failure kill the run
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
