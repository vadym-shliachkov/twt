import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml } from '../skills/twt-block-map/tools/block-map/parse.mjs';

test('builds a nested tree', () => {
  const root = parseHtml('<div class="a"><p>hi</p><span>yo</span></div>');
  assert.equal(root.children.length, 1);
  const div = root.children[0];
  assert.equal(div.tag, 'div');
  assert.deepEqual(div.classes, ['a']);
  assert.equal(div.children.length, 2);
  assert.equal(div.children[0].tag, 'p');
  assert.equal(div.children[0].text, 'hi');
});

test('void elements take no children', () => {
  const root = parseHtml('<div><img src="a.png"><p>after</p></div>');
  const div = root.children[0];
  assert.equal(div.children.length, 2);
  assert.equal(div.children[0].tag, 'img');
  assert.equal(div.children[0].children.length, 0);
  assert.equal(div.children[1].tag, 'p');
});

test('unclosed tags do not swallow siblings', () => {
  const root = parseHtml('<ul><li>one<li>two<li>three</ul>');
  const ul = root.children[0];
  assert.equal(ul.children.length, 3);
  assert.equal(ul.children[1].text, 'two');
});

test('script and style contents are not parsed as markup', () => {
  const root = parseHtml('<div><script>var a = "<p>x</p>";</script><p>real</p></div>');
  const div = root.children[0];
  assert.equal(div.children.length, 2);
  assert.equal(div.children[1].tag, 'p');
  assert.equal(div.children[1].text, 'real');
});

test('comments are dropped', () => {
  const root = parseHtml('<div><!-- <p>ghost</p> --><p>real</p></div>');
  assert.equal(root.children[0].children.length, 1);
});

test('id and multiple classes are captured', () => {
  const root = parseHtml('<section id="hero" class="a b c">x</section>');
  const s = root.children[0];
  assert.equal(s.id, 'hero');
  assert.deepEqual(s.classes, ['a', 'b', 'c']);
});

test('unterminated script does not swallow the rest of the document', () => {
  const root = parseHtml('<div><script>var a = 1;</div><p>after</p>');
  const p = root.children.find((n) => n.tag === 'p');
  assert.ok(p, 'expected a <p> node to survive an unterminated <script>');
  assert.equal(p.text, 'after');
});

test('unterminated style does not swallow the rest of the document', () => {
  const root = parseHtml('<div><style>.a { color: red;</div><p>after</p>');
  const p = root.children.find((n) => n.tag === 'p');
  assert.ok(p, 'expected a <p> node to survive an unterminated <style>');
  assert.equal(p.text, 'after');
});

// Regression: parseHtml must never throw (file header, line 7: "it never
// throws, it recovers"). An out-of-range numeric entity — beyond Unicode's
// 0x10FFFF ceiling — used to abort the whole parse with a RangeError from
// String.fromCodePoint, which would take down an entire crawl for one
// malformed entity on one page. Out-of-range entities now fall back to
// their raw, un-decoded source text instead of decoding.
test('an out-of-range hex numeric entity does not throw and is left raw', () => {
  const root = parseHtml('<p>&#x110000;</p>');
  assert.equal(root.children[0].text, '&#x110000;');
});

test('an out-of-range decimal numeric entity does not throw and is left raw', () => {
  const root = parseHtml('<p>&#1114112;</p>');
  assert.equal(root.children[0].text, '&#1114112;');
});

test('a wildly out-of-range hex numeric entity does not throw and is left raw', () => {
  const root = parseHtml('<p>&#xFFFFFFFFFF;</p>');
  assert.equal(root.children[0].text, '&#xFFFFFFFFFF;');
});

test('a valid astral numeric entity still decodes correctly', () => {
  const root = parseHtml('<p>&#x1F600;</p>');
  assert.equal(root.children[0].text, '\u{1F600}');
});

// Entity decoding must run before whitespace collapse+trim, not after —
// otherwise a whitespace-producing entity like &nbsp; leaves artifacts
// that real whitespace never would.
test('a leading &nbsp; entity does not survive as a leading space', () => {
  const root = parseHtml('<p>&nbsp;leading</p>');
  assert.equal(root.children[0].text, 'leading');
});

test('runs of &nbsp; entities collapse the same way real whitespace does', () => {
  const root = parseHtml('<p>a&nbsp;&nbsp;&nbsp;b</p>');
  assert.equal(root.children[0].text, 'a b');
});

test('<title> text is entity-decoded like ordinary text', () => {
  const root = parseHtml('<title>&ldquo;Hi&rdquo;</title><p>x</p>');
  const title = root.children.find((n) => n.tag === 'title');
  assert.equal(title.text, '“Hi”');
});
