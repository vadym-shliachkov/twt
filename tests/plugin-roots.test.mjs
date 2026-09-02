// The generated tree must be invisible to author-time tooling.
//
// plugins/<unit>/ will hold a COPY of every skill in that unit. If gen-docs,
// check-skill or check-io saw those copies, each skill would be documented and
// linted once per unit it ships in, and the name-uniqueness check would fail
// against the skill's own reflection. A `.twt-generated` marker in the plugin
// root is what tells the difference, and the default is to skip it - so a tool
// has to opt IN to seeing build output, rather than remembering to opt out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pluginRoots, skillFiles, owningPlugin } from '../tools/lib/plugin-roots.mjs';

function scratch(files) {
  const root = mkdtempSync(join(tmpdir(), 'twt-roots-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

const MARKETPLACE = JSON.stringify({
  name: 'test',
  plugins: [
    { name: 'twt', source: './' },
    { name: 'twt-demo', source: './plugins/twt-demo' },
  ],
}, null, 2);

const fixture = () => scratch({
  '.claude-plugin/marketplace.json': MARKETPLACE,
  'skills/twt-alpha/SKILL.md': '---\nname: twt-alpha\n---\n',
  'plugins/twt-demo/.twt-generated': '',
  'plugins/twt-demo/skills/twt-alpha/SKILL.md': '---\nname: twt-alpha\n---\n',
});

test('a root carrying .twt-generated is flagged generated', () => {
  const root = fixture();
  const roots = pluginRoots(root);
  assert.equal(roots.find((r) => r.name === 'twt').generated, false);
  assert.equal(roots.find((r) => r.name === 'twt-demo').generated, true);
});

test('skillFiles excludes generated roots by default', () => {
  const root = fixture();
  const found = skillFiles(root);
  assert.equal(found.length, 1, 'the skill must be reported once, from the authored tree');
  assert.equal(found[0].plugin, 'twt');
});

test('skillFiles includes generated roots on request', () => {
  const root = fixture();
  const found = skillFiles(root, { generated: true });
  assert.equal(found.length, 2, 'the build opts in to verify what it emitted');
  assert.deepEqual(found.map((f) => f.plugin).sort(), ['twt', 'twt-demo']);
});

test('a hand-placed (unmarked) plugin is still enumerated by default', () => {
  // Only the marker means build output. A plugin someone checks in by hand has
  // no marker and must keep being linted.
  const root = scratch({
    '.claude-plugin/marketplace.json': MARKETPLACE,
    'skills/twt-alpha/SKILL.md': '---\nname: twt-alpha\n---\n',
    'plugins/twt-demo/skills/twt-beta/SKILL.md': '---\nname: twt-beta\n---\n',
  });
  assert.equal(skillFiles(root).length, 2);
});

test('owningPlugin still resolves the nested root, generated or not', () => {
  const root = fixture();
  const owner = owningPlugin(root, join(root, 'plugins/twt-demo/skills/twt-alpha/SKILL.md'));
  assert.equal(owner.name, 'twt-demo', 'longest matching root wins');
});

test('the real repo reports each skill name exactly once', () => {
  const seen = new Map();
  for (const f of skillFiles(process.cwd())) {
    seen.set(f.expectedName, (seen.get(f.expectedName) || 0) + 1);
  }
  const dupes = [...seen].filter(([, n]) => n > 1);
  assert.deepEqual(dupes, [], `duplicate skill names: ${JSON.stringify(dupes)}`);
});
