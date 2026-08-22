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
// Which plugin.json to bump is no longer a constant: the repo hosts several
// plugins (.claude-plugin/marketplace.json `plugins[]`, each with a `source`
// dir), and a skill edited under ./plugins/<name>/ must bump THAT plugin's
// version, not the monolith's. Longest matching source path wins, so a nested
// plugin beats the monolith's "./". marketplace.json's own version tracks the
// registry itself, so it advances whenever anything in it did.
const pluginBumped = [];
const manifestPaths = [];
if (bumped.length) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const mktPath = path.join(root, '.claude-plugin', 'marketplace.json');

  let registry = [];
  try {
    const mkt = JSON.parse(fs.readFileSync(mktPath, 'utf8'));
    registry = (mkt.plugins || []).map((p) => ({
      name: p.name,
      root: path.resolve(root, p.source || './'),
    }));
  } catch {}

  const ownerOf = (fp) => {
    const abs = path.resolve(fp);
    return registry
      .filter((p) => abs === p.root || abs.startsWith(p.root + path.sep))
      .sort((a, b) => b.root.length - a.root.length)[0];
  };

  // Only the plugins that actually own a bumped file.
  const touched = new Map();
  for (const fp of files) {
    const owner = ownerOf(fp);
    if (owner) touched.set(owner.root, owner);
  }

  const manifests = [...touched.values()].map((p) => ({
    file: path.join(p.root, '.claude-plugin', 'plugin.json'),
    key: ['version'],
  }));
  // The registry version moves whenever any plugin in it did.
  manifests.push({ file: mktPath, key: ['metadata', 'version'] });

  for (const { file, key } of manifests) {
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      let node = json;
      for (let i = 0; i < key.length - 1 && node; i++) node = node[key[i]];
      const leaf = key[key.length - 1];
      if (!node || typeof node[leaf] !== 'string') continue;
      const sv = node[leaf].match(/^(\d+)\.(\d+)\.(\d+)$/);
      if (!sv) continue;
      const nextV = `${sv[1]}.${sv[2]}.${+sv[3] + 1}`;
      node[leaf] = nextV;
      manifestPaths.push(file);
      fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
      pluginBumped.push(`${path.basename(path.dirname(path.dirname(file))) === path.basename(root) ? '' : path.basename(path.dirname(path.dirname(file))) + '/'}${path.basename(file)} \u2192 ${nextV}`);
    } catch {}
  }
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
