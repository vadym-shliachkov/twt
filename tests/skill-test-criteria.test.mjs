import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseCriteria, criteriaHash, selfDeclaredIds } =
  await import(new URL('../tools/lib/skill-test/criteria.mjs', import.meta.url).href);

const SAMPLE = `# Criteria — twt-ia-define

### C-001 · contract · declared-write-exists

- **dimension:** contract
- **source:** frontmatter \`writes:\`
- **self-declared:** no
- **fixture:** happy
- **assert:** \`.twt-artifacts/pre-design/ia/sitemap.md\` exists and is non-empty
- **evidence:** file path + line number

### C-002 · quality · sitemap-is-plausible

- **dimension:** quality
- **source:** Intent → Success criteria
- **self-declared:** yes
- **fixture:** happy
- **assert:** every top-level page carries a one-line purpose
- **evidence:** file path + line number

## Fixtures

- **happy** — seeds positioning.md and fetched content
`;

test('parseCriteria extracts id, dimension, self-declared flag and fixture', () => {
  const list = parseCriteria(SAMPLE);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map(c => c.id), ['C-001', 'C-002']);
  assert.equal(list[0].dimension, 'contract');
  assert.equal(list[0].selfDeclared, false);
  assert.equal(list[1].selfDeclared, true);
  assert.equal(list[0].fixture, 'happy');
  assert.equal(list[1].title, 'sitemap-is-plausible');
});

test('parseCriteria defaults fixture to happy when the line is absent', () => {
  const list = parseCriteria('### C-009 · contract · x\n\n- **self-declared:** no\n');
  assert.equal(list[0].fixture, 'happy');
});

test('parseCriteria rejects duplicate ids with exit code 2', () => {
  const dup = '### C-001 · contract · a\n\n### C-001 · contract · b\n';
  let err;
  assert.throws(() => {
    try { parseCriteria(dup); } catch (e) { err = e; throw e; }
  });
  assert.equal(err.exitCode, 2);
  assert.match(err.message, /duplicate criterion id C-001/);
});

test('selfDeclaredIds returns only the self-declared ones', () => {
  assert.deepEqual(selfDeclaredIds(parseCriteria(SAMPLE)), ['C-002']);
});

test('criteriaHash is stable across CRLF and LF line endings', () => {
  const lf = 'a\nb\nc\n';
  const crlf = 'a\r\nb\r\nc\r\n';
  assert.equal(criteriaHash(lf), criteriaHash(crlf));
  assert.match(criteriaHash(lf), /^sha256:[0-9a-f]{64}$/);
});

test('criteriaHash changes when a criterion changes', () => {
  assert.notEqual(criteriaHash(SAMPLE), criteriaHash(SAMPLE.replace('non-empty', 'empty')));
});
