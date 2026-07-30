import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

// fileURLToPath (not a manual .pathname regex) so percent-encoded characters in
// the repo path (this repo lives under "C:\Work\~marketplace") decode correctly.
const SCRIPT = fileURLToPath(new URL('../tools/checklist-xlsx.py', import.meta.url));

// The builder needs python + openpyxl; self-SKIP rather than fail where absent.
function python() {
  for (const bin of ['python', 'python3', 'py']) {
    try {
      execFileSync(bin, ['-c', 'import openpyxl'], { stdio: 'ignore' });
      return bin;
    } catch { /* try the next candidate */ }
  }
  return null;
}

const SPEC = {
  worksheets: [{
    name: 'Home',
    blocks: [{
      name: 'Hero',
      rows: [
        { field_type: 'text:headline', current: 'Lorem', recommended: 'Real copy' },
        { field_type: 'link:cta_url', current: '#', recommended: '/contact', ready: true },
      ],
    }],
  }],
};

function build() {
  const bin = python();
  if (!bin) return null;
  const dir = mkdtempSync(join(tmpdir(), 'twt-checklist-'));
  const spec = join(dir, 'spec.json');
  const out = join(dir, 'book.xlsx');
  writeFileSync(spec, JSON.stringify(SPEC), 'utf8');
  execFileSync(bin, [SCRIPT, 'build', '--spec', spec, '--out', out], { encoding: 'utf8' });
  return out;
}

// Minimal reader: pull one entry out of the .xlsx (a zip) with no dependency.
// Walks the central directory (authoritative for offsets/sizes) rather than
// chaining local headers, then inflates the raw-deflate payload.
function entry(xlsxPath, name) {
  const buf = readFileSync(xlsxPath);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) return null;
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let n = 0; n < count; n++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const found = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (found === name) {
      const method = buf.readUInt16LE(p + 10);
      const compressed = buf.readUInt32LE(p + 20);
      const lho = buf.readUInt32LE(p + 42);
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const body = buf.subarray(start, start + compressed);
      return (method === 0 ? body : inflateRawSync(body)).toString('utf8');
    }
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return null;
}

test('ready-cell rules match the boolean TRUE/FALSE Excel coerces dropdown picks into', () => {
  const out = build();
  if (!out) { console.log('SKIP: openpyxl unavailable'); return; }
  const sheet = entry(out, 'xl/worksheets/sheet1.xml');
  assert.ok(sheet, 'sheet1.xml is readable');

  const formulas = [...sheet.matchAll(/<formula>([^<]*)<\/formula>/g)].map((m) => m[1]);
  const cf = formulas.filter((f) => f.includes('$F2'));
  assert.equal(cf.length, 2, 'one green + one pink readiness rule');

  // Each rule must coerce the cell to text (&"") before comparing. A bare
  // ="true" / =TRUE comparison silently stops matching once Excel turns the
  // picked dropdown item into a real boolean — the bug that kept ready rows pink.
  for (const f of cf) {
    assert.match(f, /\$F2&amp;""=/, `rule coerces to text before comparing: ${f}`);
  }
  assert.ok(cf.some((f) => f.endsWith('"true"')), 'a rule matches true');
  assert.ok(cf.some((f) => f.endsWith('"false"')), 'a rule matches false');
});

test('readiness fills are opaque and set both dxf pattern colors', () => {
  const out = build();
  if (!out) { console.log('SKIP: openpyxl unavailable'); return; }
  const styles = entry(out, 'xl/styles.xml');
  const dxfs = /<dxfs[\s\S]*?<\/dxfs>/.exec(styles);
  assert.ok(dxfs, 'workbook has differential formats');

  const colors = [...dxfs[0].matchAll(/(fgColor|bgColor) rgb="([0-9A-Fa-f]{8})"/g)];
  assert.equal(colors.length, 4, 'both dxfs set fgColor and bgColor');
  // A dxf resolves a solid fill from bgColor while cellXfs use fgColor, and a
  // 6-digit hex gets padded to alpha 00 (transparent) — both drop the fill.
  for (const [, , argb] of colors) {
    assert.match(argb, /^FF/, `fill color is opaque, not alpha-00: ${argb}`);
  }
});

test('the ready column carries a true/false dropdown on field rows only', () => {
  const out = build();
  if (!out) { console.log('SKIP: openpyxl unavailable'); return; }
  const sheet = entry(out, 'xl/worksheets/sheet1.xml');
  const dv = /<dataValidation[\s\S]*?<\/dataValidation>/.exec(sheet);
  assert.ok(dv, 'a data validation exists');
  assert.match(dv[0], /"true,false"/);
  // Row 2 is the merged Hero banner; the two field rows are 3 and 4.
  assert.match(dv[0], /sqref="F3 F4"/);
});
