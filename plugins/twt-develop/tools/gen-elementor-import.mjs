#!/usr/bin/env node
// gen-elementor-import.mjs — deterministic Elementor page-import generator.
//
// /twt-elementor-block-creator used to hand-write the Elementor 3.x import.json
// — including "generate unique 8-character lowercase hex IDs for every id field"
// — which is exactly the model-typo class of bug (colliding IDs, malformed JSON,
// a widgetType that doesn't match any registered widget and fails the import
// with no error). This script owns the JSON mechanics; the model owns the
// layout plan (which sections, which widget per section).
//
//   node gen-elementor-import.mjs --title "<Page Title>" --out <path/import.json>
//        --section <widgetType[,widgetType...]>   (repeatable; one top-level
//                                                  container per --section, the
//                                                  comma list = widgets inside it)
//        [--map <class-<slug>-elementor.php>]     (validate every widgetType
//                                                  against the manager's $map)
//        [--strict]                               (unregistered widgetType = exit 1;
//                                                  default is warn-only, for parallel
//                                                  mode where $map registration is
//                                                  merged later by the orchestrator)
//
// widgetType must be the widget's get_name() — `<project-slug>_<widget-slug>`.
// Output: writes import.json (creates parent dirs), prints a ```json summary
// { out, sections, widgets, warnings[] }. Exit 0 ok, 1 strict-validation failure,
// 2 usage error.
'use strict';

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const sections = [];
let title = null, out = null, mapPath = null, strict = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--title') title = args[++i];
  else if (a === '--out') out = args[++i];
  else if (a === '--section') sections.push(args[++i]);
  else if (a === '--map') mapPath = args[++i];
  else if (a === '--strict') strict = true;
  else { console.error(`unknown argument: ${a}`); process.exit(2); }
}
if (!title || !out || sections.length === 0) {
  console.error('usage: gen-elementor-import.mjs --title <t> --out <import.json> --section <widgetType[,w2]> [--section ...] [--map <manager.php>] [--strict]');
  process.exit(2);
}

// ---- unique 8-char lowercase hex IDs -----------------------------------------
const used = new Set();
function eid() {
  let id;
  do { id = randomBytes(4).toString('hex'); } while (used.has(id));
  used.add(id);
  return id;
}

// ---- optional $map validation --------------------------------------------------
// The manager registers `'widget-slug' => 'ClassName'` inside `$map = [ ... ];`
// and each widget's get_name() is `<project-slug>_<widget-slug>`. Normalize
// hyphens/underscores on both sides — the two conventions coexist in the wild.
const warnings = [];
if (mapPath) {
  let php;
  try { php = readFileSync(mapPath, 'utf8'); }
  catch { console.error(`--map file not found: ${mapPath}`); process.exit(2); }
  const mapBlock = /\$map\s*=\s*\[([\s\S]*?)\];/.exec(php);
  if (!mapBlock) {
    warnings.push(`no $map = [ ... ] block found in ${mapPath} — widgetTypes not validated`);
  } else {
    const keys = [...mapBlock[1].matchAll(/^\s*'([^']+)'\s*=>/gm)].map((m) => m[1]);
    const norm = (s) => s.toLowerCase().replace(/-/g, '_');
    const slugM = /class-([a-z0-9-]+)-elementor\.php$/i.exec(mapPath.replace(/\\/g, '/'));
    const projectSlug = slugM ? norm(slugM[1]) : null;
    for (const s of sections) {
      for (const w of s.split(',').map((x) => x.trim()).filter(Boolean)) {
        const wn = norm(w);
        const ok = keys.some((k) => {
          const kn = norm(k);
          return wn === kn || wn.endsWith(`_${kn}`) || (projectSlug && wn === `${projectSlug}_${kn}`);
        });
        if (!ok) warnings.push(`widgetType "${w}" matches no $map key in ${mapPath} (keys: ${keys.join(', ') || 'none'}) — the import will silently drop it unless the widget is registered`);
      }
    }
  }
}

// ---- build the Elementor 3.x container-layout template -------------------------
const content = sections.map((s) => ({
  id: eid(),
  elType: 'container',
  settings: {
    content_width: 'full',
    flex_direction: 'column',
    padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
  },
  elements: s.split(',').map((x) => x.trim()).filter(Boolean).map((w) => ({
    id: eid(),
    elType: 'widget',
    widgetType: w,
    settings: {}, // admin fills content in Elementor
  })),
  isInner: false,
}));

const doc = { version: '0.4', title, type: 'page', content, page_settings: {} };

if (strict && warnings.length) {
  for (const w of warnings) console.error(`STRICT: ${w}`);
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n', 'utf8');

const widgetCount = content.reduce((n, c) => n + c.elements.length, 0);
console.log(`gen-elementor-import: wrote ${out} — ${content.length} section(s), ${widgetCount} widget(s)${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
console.log('```json');
console.log(JSON.stringify({ out, sections: content.length, widgets: widgetCount, warnings }, null, 2));
console.log('```');
