#!/usr/bin/env node
/**
 * Stop hook.
 * Reads the per-session queue written by record-skill-edit.js and bumps the PATCH
 * version (X.Y.Z -> X.Y.Z+1) of each skill file edited this turn — once each —
 * then clears the queue. Runs after the turn, so it never races the model's edits.
 *
 * When at least one skill was bumped, it also bumps the PATCH version of the two
 * plugin manifests once — plugin.json (.version, what /plugin reports) and
 * marketplace.json (.metadata.version) — so the published plugin version advances
 * on every meaningful update. Done in-process here (not a second Stop hook)
 * because this script consumes and deletes the queue, so nothing else can detect
 * the skill bump afterward.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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
    // Sub-skills are all named SKILL.md — label them by their directory instead.
    const label = path.basename(fp) === 'SKILL.md' ? path.basename(path.dirname(fp)) : path.basename(fp);
    bumped.push(`${label} → ${major}.${minor}.${patch}`);
  } catch {}
}

// When any skill bumped this session, advance the manifests once each.
//
// Versions are per UNIT now, and a unit is not a directory.
//
// Every skill is authored in the monolith; which plugin it SHIPS in is declared
// by its `unit:` frontmatter, and per-unit versions live in
// .claude-plugin/units.json. marketplace.json is GENERATED from that registry,
// so bumping it directly would be overwritten by the next build - the registry
// is the thing to move.
//
// The rebuild at the end is not optional. Each generated unit's plugin.json
// carries the version, so skipping it leaves committed output disagreeing with
// the registry, and CI then fails on the next push with a misleading blame.
const pluginBumped = [];
const manifestPaths = [];
if (bumped.length) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const unitsPath = path.join(root, '.claude-plugin', 'units.json');
  const rootManifest = path.join(root, '.claude-plugin', 'plugin.json');

  const nextPatch = (v) => {
    const sv = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
    return sv ? sv[1] + '.' + sv[2] + '.' + (+sv[3] + 1) : null;
  };

  // Which units own a bumped skill, read from each file's own frontmatter.
  const touchedUnits = new Set();
  for (const fp of files) {
    try {
      const m = fs.readFileSync(fp, 'utf8').match(/^unit:[ \t]*(\S+)[ \t]*$/m);
      if (m) touchedUnits.add(m[1]);
    } catch {}
  }

  try {
    const reg = JSON.parse(fs.readFileSync(unitsPath, 'utf8'));
    let moved = false;
    for (const unit of touchedUnits) {
      const u = reg.units && reg.units[unit];
      if (!u) continue;
      const nv = nextPatch(u.version);
      if (!nv) continue;
      u.version = nv;
      moved = true;
      pluginBumped.push(unit + ' → ' + nv);
    }
    // The registry version moves whenever any unit in it did.
    if (moved && reg.marketplace) {
      const nv = nextPatch(reg.marketplace.version);
      if (nv) {
        reg.marketplace.version = nv;
        pluginBumped.push('marketplace → ' + nv);
      }
    }
    if (moved) {
      fs.writeFileSync(unitsPath, JSON.stringify(reg, null, 2) + '\n');
      manifestPaths.push(unitsPath);
    }
  } catch {}

  // The bundle's own manifest still tracks the repo as a whole.
  try {
    const json = JSON.parse(fs.readFileSync(rootManifest, 'utf8'));
    const nv = nextPatch(json.version);
    if (nv) {
      json.version = nv;
      fs.writeFileSync(rootManifest, JSON.stringify(json, null, 2) + '\n');
      manifestPaths.push(rootManifest);
      pluginBumped.push('plugin.json → ' + nv);
    }
  } catch {}

}

if (bumped.length) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Append one line per bump to CHANGELOG.md so ~60 auto-bumped plugin
  // versions stop being an opaque number to updaters. Newest entries right
  // under the header; feature context lives in the git log this line points at.
  try {
    const clPath = path.join(root, 'CHANGELOG.md');
    const header = '# Changelog\n\nAuto-maintained: one line per plugin version bump (newest first); `git log` carries the full story.\n\n';
    const pv = pluginBumped.length ? pluginBumped[0].split('→')[1].trim() : '';
    const line = `- ${new Date().toISOString().slice(0, 10)}${pv ? ` **v${pv}**` : ''} — ${bumped.join(', ')}\n`;
    let existing = '';
    try { existing = fs.readFileSync(clPath, 'utf8'); } catch {}
    // keep every prior entry (lines from the first "- " on), whatever the header was
    const firstEntry = existing.indexOf('\n- ');
    const body = firstEntry === -1 ? '' : existing.slice(firstEntry + 1);
    fs.writeFileSync(clPath, header + line + body);
  } catch {}

  // Auto-regenerate derived docs (SKILLS.md, architecture.md, README table).
  const genDocs = path.join(root, 'tools', 'gen-docs.mjs');
  let docsResult = '';
  try {
    const r = spawnSync(process.execPath, [genDocs], { cwd: root, encoding: 'utf8', timeout: 30000 });
    docsResult = r.status === 0 ? 'docs synced' : 'docs sync failed (run /twt-marketplace-docs manually)';
  } catch {
    docsResult = 'docs sync failed (run /twt-marketplace-docs manually)';
  }

  // Regenerate the unit plugins LAST. gen-docs re-stamps each SKILL.md
  // description from its version, and every unit ships a copy of those files -
  // so rebuilding before that ran would bake in the pre-stamp text and CI would
  // fail --check on the next push.
  try {
    const rb = spawnSync(process.execPath, [path.join(root, 'tools', 'build-units.mjs')], { cwd: root, encoding: 'utf8', timeout: 120000 });
    if (rb.status === 0) {
      manifestPaths.push(path.join(root, '.claude-plugin', 'marketplace.json'));
      manifestPaths.push(path.join(root, 'plugins'));
    } else {
      docsResult += '; unit build failed (run node tools/build-units.mjs)';
    }
  } catch {
    docsResult += '; unit build failed (run node tools/build-units.mjs)';
  }

  // Auto-commit the bumped files so the next session never opens with uncommitted
  // version changes. Only add the specific files this hook touched — nothing else.
  let commitResult = '';
  try {
    const addTargets = [
      ...files,                                                          // bumped skill files
      ...manifestPaths,   // every plugin.json that moved, plus the registry
      path.join(root, 'SKILLS.md'),
      path.join(root, 'architecture.md'),
      path.join(root, 'README.md'),
      path.join(root, 'CHANGELOG.md'),
    ].filter(fp => { try { return require('fs').existsSync(fp); } catch { return false; } });
    const ra = spawnSync('git', ['add', '--', ...addTargets], { cwd: root, encoding: 'utf8' });
    if (ra.status === 0) {
      const msg = `chore: auto-bump ${bumped.join(', ')}${pluginBumped.length ? ' + ' + pluginBumped.join(', ') : ''}`;
      const rc = spawnSync('git', ['commit', '-m', msg], { cwd: root, encoding: 'utf8' });
      commitResult = rc.status === 0 ? 'committed' : (rc.stderr || '').trim() || 'commit failed';
    } else {
      commitResult = 'git add failed';
    }
  } catch (e) {
    commitResult = 'commit failed: ' + (e && e.message);
  }

  const parts = [`Auto-bumped skill version: ${bumped.join(', ')}`];
  if (pluginBumped.length) parts.push(`plugin: ${pluginBumped.join(', ')}`);
  parts.push(docsResult);
  parts.push(commitResult);
  process.stdout.write(JSON.stringify({ systemMessage: parts.join(' · ') }));
}
process.exit(0);
