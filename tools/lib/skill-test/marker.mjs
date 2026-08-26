// marker.mjs — ownership marker for /twt-skill-test target trees.
//
// This is the only module in the harness that deletes anything, and the only
// thing standing between an agentic fix loop and a real project's artifacts.
// Both seed and clean refuse a tree that is not demonstrably ours.
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const MARKER = '.twt-skill-test-owned';

function refuse(msg) {
  const e = new Error(`skill-test: REFUSING — ${msg}`);
  e.exitCode = 3;
  throw e;
}

export function assertOwned(root) {
  if (!existsSync(join(root, MARKER)))
    refuse(`${root} has no ${MARKER} ownership marker (this is not a skill-test fixture)`);
}

export function seedTarget(root, { skill, runDir, fixture }) {
  // Refuse BEFORE any destructive call: an existing tree with contents and no
  // marker is someone's real project.
  if (existsSync(root) && readdirSync(root).length) assertOwned(root);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, MARKER),
    JSON.stringify({ skill, runDir, fixture, created: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
}

export function cleanTarget(root) {
  if (!existsSync(root)) return false;
  assertOwned(root);
  rmSync(root, { recursive: true, force: true });
  return true;
}
