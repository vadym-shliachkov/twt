import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml } from '../tools/block-map/parse.mjs';

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
