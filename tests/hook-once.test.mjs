// Hook scripts are vendored into every unit (spec D6), so a user with a unit
// AND the bundle installed runs the same script twice per tool call. Every hook
// must therefore act once per identical payload per session.
//
// The helper also has to serve the figma-read guard, which nags ONCE PER
// SESSION rather than once per call - it gets that by hashing a payload
// reduced to just the session id, not by a second mechanism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from '../hooks/lib/once.js';

const dir = () => mkdtempSync(join(tmpdir(), 'twt-once-'));

test('the first call for a payload acts, the second does not', () => {
  const d = dir();
  const payload = JSON.stringify({ session_id: 's1', tool_name: 'Bash' });
  assert.equal(once('demo', payload, d), true, 'first call must act');
  assert.equal(once('demo', payload, d), false, 'second call must not act');
});

test('a different payload in the same session acts again', () => {
  const d = dir();
  const a = JSON.stringify({ session_id: 's1', tool_name: 'Bash' });
  const b = JSON.stringify({ session_id: 's1', tool_name: 'Read' });
  assert.equal(once('demo', a, d), true);
  assert.equal(once('demo', b, d), true, 'a distinct payload is a distinct event');
});

test('the same payload in a different session acts again', () => {
  const d = dir();
  const a = JSON.stringify({ session_id: 's1', tool_name: 'Bash' });
  const b = JSON.stringify({ session_id: 's2', tool_name: 'Bash' });
  assert.equal(once('demo', a, d), true);
  assert.equal(once('demo', b, d), true, 'suppression must never leak across sessions');
});

test('two hook names do not share a marker', () => {
  const d = dir();
  const payload = JSON.stringify({ session_id: 's1', tool_name: 'Bash' });
  assert.equal(once('alpha', payload, d), true);
  assert.equal(once('beta', payload, d), true, 'markers are namespaced by hook name');
});

test('a session-only key gives once-per-session semantics', () => {
  // How the figma-read guard keeps its behaviour: reduce the payload to the
  // session id and every distinct call in that session collapses to one event.
  const d = dir();
  const key = (s) => JSON.stringify({ session_id: s });
  assert.equal(once('figma-read', key('s1'), d), true);
  assert.equal(once('figma-read', key('s1'), d), false, 'still once for the whole session');
  assert.equal(once('figma-read', key('s2'), d), true);
});

test('a non-JSON payload is still suppressed correctly', () => {
  const d = dir();
  assert.equal(once('demo', 'not json at all', d), true);
  assert.equal(once('demo', 'not json at all', d), false);
});

test('a marker write failure never blocks the hook', () => {
  // Fail OPEN. A hook that cannot write a marker must still run: failing closed
  // would silently disable the scope guard, which is a security control.
  assert.equal(once('demo', '{}', join('/definitely/not/a/dir/anywhere')), true);
});
