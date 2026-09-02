// "Installs" and "works" are different claims.
//
// A skill that dispatches a sibling from another unit, or reads an artifact
// only another unit produces, must say IN ITS OWN TEXT what it does when that
// is absent. The skill text is the only thing that travels into a run, so a
// fallback that lives anywhere else may as well not exist - and the failure
// lands mid-run, which is the worst moment to discover it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { obligations } from '../tools/standalone-report.mjs';
import { loadUnits } from '../tools/lib/units.mjs';

const all = obligations(process.cwd());
const reg = loadUnits(process.cwd());
const readyOnes = all.filter((o) => reg.units[o.unit] && reg.units[o.unit].ready);

test('obligations are computed per skill and name the other unit', () => {
  const withAny = all.filter((o) => o.dispatch.length || o.inputs.length);
  assert.ok(withAny.length > 0, 'the pipeline has cross-unit edges by construction');
  for (const o of withAny) {
    for (const d of o.dispatch) assert.ok(d.unit && d.unit !== o.unit, `${o.name} -> ${d.name}`);
    for (const i of o.inputs) {
      assert.ok(i.units.length > 0, `${o.name} reads ${i.path}`);
      assert.ok(!i.units.includes(o.unit), `${o.name} reads ${i.path} from its own unit`);
    }
  }
});

test('a same-unit dependency creates no obligation', () => {
  // twt-brand dispatches its own family, all of which ships in the same unit.
  // Demanding a fallback for those would be noise that trains people to ignore
  // the lint.
  const brand = all.find((o) => o.name === 'twt-brand');
  assert.ok(brand, 'twt-brand exists');
  assert.ok(!brand.dispatch.some((d) => d.name.startsWith('twt-brand-')),
    'its own family members are in its own unit');
});

test('every READY unit documents its cross-unit fallbacks', () => {
  const failures = readyOnes
    .filter((o) => o.undocumented.length > 0)
    .map((o) => `${o.name}: ${o.undocumented.join(', ')}`);
  assert.deepEqual(failures, [], 'a ready unit must document every cross-unit fallback');
});

test('no READY unit hard-aborts on an input another unit produces', () => {
  // twt-audience-define is the reference case: "If absent, abort - run
  // /twt-positioning-define first" is correct in the bundle and fatal in a
  // standalone install, where that skill does not exist to run.
  const failures = readyOnes
    .filter((o) => o.hardAborts.length > 0)
    .map((o) => `${o.name}: ${o.hardAborts.join(', ')}`);
  assert.deepEqual(failures, []);
});

test('the abort check is paragraph-scoped, not file-scoped', () => {
  // A skill may legitimately abort on something else entirely. Matching across
  // the whole file would flag nearly every skill, and a lint that cries wolf
  // gets switched off.
  const withInputs = all.filter((o) => o.inputs.length > 0);
  assert.ok(withInputs.length > 0, 'the pipeline has cross-unit inputs');
  for (const o of withInputs) {
    for (const p of o.hardAborts) {
      const base = p.split('/').pop();
      const proven = o.body.split(/\n\s*\n/).some((para) => /\babort/i.test(para) && para.includes(base));
      assert.ok(proven, `${o.name}: ${p} reported without a paragraph naming it`);
    }
  }
});

test('the report is stable enough to drive a backlog', () => {
  // Every entry carries the fields the lint and the report both read.
  for (const o of all) {
    assert.equal(typeof o.name, 'string');
    assert.ok(Array.isArray(o.dispatch));
    assert.ok(Array.isArray(o.inputs));
    assert.ok(Array.isArray(o.undocumented));
    assert.ok(Array.isArray(o.hardAborts));
  }
});
