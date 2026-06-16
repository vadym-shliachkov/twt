#!/usr/bin/env node
/**
 * Stop hook.
 * Reads the per-session queue written by record-skill-edit.js and bumps the PATCH
 * version (X.Y.Z -> X.Y.Z+1) of each skill file edited this turn — once each —
 * then clears the queue. Runs after the turn, so it never races the model's edits.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}

let data = {};
try { data = JSON.parse(raw || '{}'); } catch {}

const session = String(data.session_id || 'nosession').replace(/[^a-zA-Z0-9_-]/g, '_');
const queue = path.join(os.tmpdir(), `twt-bump-${session}.txt`);

let files = [];
try { files = fs.readFileSync(queue, 'utf8').split('\n').filter(Boolean); } catch { process.exit(0); }
files = [...new Set(files)];
try { fs.unlinkSync(queue); } catch {}
if (files.length === 0) process.exit(0);

const bumped = [];
for (const fp of files) {
  let txt;
  try { txt = fs.readFileSync(fp, 'utf8'); } catch { continue; }
  // version: X.Y.Z on its own line (frontmatter). [ \t] only — never span newlines.
  const m = txt.match(/^(version:[ \t]*)(\d+)\.(\d+)\.(\d+)[ \t]*$/m);
  if (!m) continue;
  const major = +m[2], minor = +m[3], patch = +m[4] + 1;
  const next = `${m[1]}${major}.${minor}.${patch}`;
  try {
    fs.writeFileSync(fp, txt.replace(m[0], next));
    bumped.push(`${path.basename(fp)} → ${major}.${minor}.${patch}`);
  } catch {}
}

if (bumped.length) {
  process.stdout.write(JSON.stringify({
    systemMessage: `Auto-bumped skill version: ${bumped.join(', ')} (run /twt-marketplace-docs to sync docs)`,
  }));
}
process.exit(0);
