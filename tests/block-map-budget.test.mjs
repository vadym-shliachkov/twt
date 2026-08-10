import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL('../tools/block-map.mjs', import.meta.url));
const FIX = fileURLToPath(new URL('./fixtures/block-map-site', import.meta.url));

// ~4 chars per token is the conventional rough ratio; 15k tokens ~= 60k chars.
const BUDGET_CHARS = 60000;

test('stdout + summary.json + gray-band.json stay inside the token budget', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const { stdout } = await run('node', [TOOL, FIX, '--out', out, '--static']);
  const total = stdout.length
    + readFileSync(join(out, 'summary.json'), 'utf8').length
    + readFileSync(join(out, 'gray-band.json'), 'utf8').length;
  assert.ok(total < BUDGET_CHARS, `model-visible payload was ${total} chars, budget ${BUDGET_CHARS}`);
});

test('no script prints an artifact it also wrote to disk', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const { stdout } = await run('node', [TOOL, FIX, '--out', out, '--static']);
  for (const f of readdirSync(out).filter((f) => f.endsWith('.json'))) {
    const body = readFileSync(join(out, f), 'utf8').trim();
    const probe = body.slice(0, 200);
    assert.ok(!stdout.includes(probe), `stdout contains the opening of ${f} — this is the ds-audit failure mode`);
  }
});

test('gray-band.json respects the 60-pair cap', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  await run('node', [TOOL, FIX, '--out', out, '--static']);
  assert.ok(JSON.parse(readFileSync(join(out, 'gray-band.json'), 'utf8')).length <= 60);
});
