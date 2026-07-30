// scan.js - Figma Plugin API scan payload for /twt-figma-dev-audit.
//
// Read as TEXT and evaluated inside the Figma plugin sandbox by use_figma.
// Therefore: no import/export, no ESM syntax, ES2020 only.
//
// The model never improvises this scan. A scan that drifts between runs
// produces findings that drift between runs, and the audit stops being
// trustworthy the first time a client notices.
//
// Tests load it with `new Function('figma', src + 'return collectFacts(...)')`,
// which is the same evaluation shape the sandbox uses.

function hexOf(paint) {
  if (!paint || paint.type !== 'SOLID' || !paint.color) return null;
  var to = function (v) {
    var s = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16);
    return s.length === 1 ? '0' + s : s;
  };
  return '#' + to(paint.color.r) + to(paint.color.g) + to(paint.color.b);
}

function paints(list) {
  if (!Array.isArray(list)) return [];
  return list.map(function (p) {
    return {
      type: p.type || null,
      hex: hexOf(p),
      opacity: typeof p.opacity === 'number' ? p.opacity : 1,
      boundVariable: !!(p.boundVariables && p.boundVariables.color),
    };
  });
}

function effectsOf(node) {
  if (!Array.isArray(node.effects)) return [];
  return node.effects.map(function (e) {
    return {
      type: e.type || null,
      radius: typeof e.radius === 'number' ? e.radius : null,
      spread: typeof e.spread === 'number' ? e.spread : null,
      blendMode: e.blendMode || null,
    };
  });
}

function exportsOf(node) {
  if (!Array.isArray(node.exportSettings)) return [];
  return node.exportSettings.map(function (s) {
    return {
      format: s.format || null,
      constraintType: s.constraint ? s.constraint.type : null,
      constraintValue: s.constraint ? s.constraint.value : null,
    };
  });
}

// COMPONENT / COMPONENT_SET expose componentPropertyDefinitions; INSTANCE
// exposes componentProperties. Reading only one reports 0 for half the file.
function propCount(node) {
  var defs = node.componentPropertyDefinitions || node.componentProperties;
  return defs ? Object.keys(defs).length : 0;
}

// Plain containers that could be the residue of a detached instance.
var DETACH_SUSPECT_TYPES = { FRAME: true, GROUP: true };

// Pre-pass: every COMPONENT / COMPONENT_SET name in the file. A FRAME or GROUP
// sharing one of these names is the only trace a detached instance leaves -
// the Plugin API has no wasInstance flag.
function collectComponentNames(root, out) {
  if (root.type === 'COMPONENT' || root.type === 'COMPONENT_SET') out[root.name] = true;
  (root.children || []).forEach(function (c) { collectComponentNames(c, out); });
  return out;
}

function isFractional(node) {
  var vals = [node.x, node.y, node.width, node.height];
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (typeof v === 'number' && Math.abs(v - Math.round(v)) > 0.01) return true;
  }
  return false;
}

// A node is out of bounds when its box escapes its owning top-level frame.
// 0.5px tolerance absorbs Figma's sub-pixel rounding.
//
// x/y on SceneNode are relative to the *immediate* parent, not the canvas,
// so they are only directly comparable when both boxes are in the same
// space. absoluteBoundingBox puts a box in canvas space, which works at any
// depth - but only if BOTH sides use it. Choosing the space independently
// per side (e.g. canvas box for the node, local box for the frame, because
// only one of them happened to expose absoluteBoundingBox) reintroduces the
// exact bug this function exists to avoid, just for a narrower case. So the
// space is decided once, jointly, for the whole comparison: canvas space
// when both node and frame expose absoluteBoundingBox, local space
// otherwise - never mixed.
//
// In local space the frame is its own origin: a direct child's x/y already
// describes its position relative to the frame's own top-left corner, so
// the frame's box in that space is {0, 0, width, height} - never
// frame.x/frame.y, which is the frame's position in ITS OWN parent (the
// page), not the origin its children are measured from. This local
// fallback is only strictly correct for direct children of the frame;
// a deeper descendant's x/y is relative to its own immediate parent, which
// this fallback has no way to see.
function escapesFrame(node, frame) {
  if (!frame) return false;
  var t = 0.5;
  var nodeBox, frameBox;
  if (node.absoluteBoundingBox && frame.absoluteBoundingBox) {
    nodeBox = node.absoluteBoundingBox;
    frameBox = frame.absoluteBoundingBox;
  } else {
    nodeBox = { x: node.x, y: node.y, width: node.width, height: node.height };
    frameBox = { x: 0, y: 0, width: frame.width, height: frame.height };
  }
  return (
    nodeBox.x < frameBox.x - t ||
    nodeBox.y < frameBox.y - t ||
    nodeBox.x + nodeBox.width > frameBox.x + frameBox.width + t ||
    nodeBox.y + nodeBox.height > frameBox.y + frameBox.height + t
  );
}

// ---------------------------------------------------------------------------
// Reduction: why this file does not return every node
//
// The first version pushed one ~35-field record per node for every node in the
// file and returned the lot as one JSON string through use_figma. That is fine
// for a 2,000-node file and impossible for a real one: a production landing
// page measured 84,704 nodes, which serialises to roughly 75 MB. It did not
// fail loudly - it failed by never coming back, and the audit silently
// continued on model judgment alone with a clean-looking report at the end.
//
// So the walk still visits every node (the counts must be true), but only
// nodes a rule could actually fire on are RETURNED. Everything else is
// counted, not carried.
//
// The keep reasons below are named after the rule each one feeds. That is a
// deliberate coupling to tools/figma-dev-audit/rules/*: change a rule's
// predicate and this list has to change with it. The coupling is defended
// mechanically, not by this comment - tests/figma-dev-scan.test.mjs runs the
// whole rule set over an unreduced tree and over the reduced one and asserts
// the findings are identical. A predicate that drifts fails there.
var MAX_NODES = 300000;        // walk budget; past this the scan says so
var MAX_PER_REASON = 100;      // samples per reason; the true count is kept

var DEFAULT_NAME_RE = /^(Frame|Group|Rectangle|Component) \d+$|^Copy \d+$/;
var INTERACTIVE_RE = /button|input|field|card|chip|tag|badge/i;
var CONTROL_RE = /button|icon|close|menu|toggle/i;
var SPACER_RE = /spacer|gap|spacing/i;
var RASTER_RE = /^(PNG|JPG)$/i;
var VECTORISH = { VECTOR: 1, BOOLEAN_OPERATION: 1, STAR: 1, POLYGON: 1, LINE: 1 };
var PLAIN_BLEND = { PASS_THROUGH: 1, NORMAL: 1 };
var LONG_TEXT = 20;            // AL001
var HEAVY_OVERRIDES = 8;       // CM002
var MIN_TARGET = 44;           // A11Y002

// Every reason a node has to survive the reduction. `rec` is the finished
// record, so this reads exactly like the rule that consumes it.
function keepReasons(rec) {
  var out = [];
  if (rec.depth <= 1) out.push('context');   // frames and their sections
  if (rec.type === 'TEXT') {
    out.push('A11Y001');                     // contrast needs every text node
    if (rec.textAutoResize === 'NONE' && (rec.charCount || 0) >= LONG_TEXT) out.push('AL001');
  }
  if (!rec.layoutMode && rec.childCount >= 3 && rec.absChildCount !== rec.childCount) out.push('AL002');
  if (rec.type === 'RECTANGLE' && SPACER_RE.test(rec.name) && !rec.fills.length) out.push('AL003');
  if (rec.outOfBounds) out.push('RS001');
  if (rec.nameMatchesComponent) out.push('CM001');
  if (rec.isInstance && rec.overrideCount >= HEAVY_OVERRIDES) out.push('CM002');
  if (rec.type === 'COMPONENT' && INTERACTIVE_RE.test(rec.name)
      && rec.componentPropertyCount === 0 && !rec.variantProperties) out.push('CM003');
  if (DEFAULT_NAME_RE.test(rec.name)) out.push('CM004');
  if (rec.hasImageFill && !rec.exportSettings.length) out.push('AS001');
  if (VECTORISH[rec.type] && rec.exportSettings.some(function (e) { return RASTER_RE.test(e.format || ''); })) out.push('AS002');
  if (rec.effects.some(function (e) { return e.type === 'BACKGROUND_BLUR' || e.type === 'LAYER_BLUR'; })) out.push('FX001');
  if (!PLAIN_BLEND[rec.blendMode || 'NORMAL'] || (rec.isMask && rec.type !== 'FRAME')) out.push('FX002');
  if (!rec.visible && rec.exportSettings.length) out.push('HY001');
  if (rec.fractional) out.push('HY002');
  if (CONTROL_RE.test(rec.name) && (rec.width < MIN_TARGET || rec.height < MIN_TARGET)) out.push('A11Y002');
  return out;
}

// opts.scope (optional) limits the walk to the named page or top-level frame.
// Matching is case-insensitive SUBSTRING on the name: "pricing" matches
// "Pricing / Desktop" and "Pricing / Mobile", which is what a user scoping a
// screen means. A scope naming a PAGE pulls in every top-level frame on it; a
// scope naming a SECTION pulls in every frame inside it. Pages that end up
// contributing nothing are not listed in facts.file.pages, so a scoped scan
// can never be mistaken for a whole-file one.
function collectFacts(root, opts) {
  var componentNames = collectComponentNames(root, {});
  var scopeRaw = opts && opts.scope ? String(opts.scope) : null;
  // opts.reduce === false returns every node instead of the rule-relevant
  // sample. The sandbox entry point never sets it - it exists so the test
  // suite can run the whole rule set over both node sets and assert the
  // findings are identical, which is the only thing keeping keepReasons()
  // honest about the rules it mirrors.
  // opts.maxNodes lowers the walk budget so the truncation path is reachable
  // in a test without building 300,000 fixture nodes. Same rule: the sandbox
  // entry point never sets it.
  var reduce = !(opts && opts.reduce === false);
  var maxNodes = opts && typeof opts.maxNodes === 'number' ? opts.maxNodes : MAX_NODES;
  var scope = scopeRaw ? scopeRaw.toLowerCase() : null;
  var inScopeName = function (name) {
    return String(name || '').toLowerCase().indexOf(scope) !== -1;
  };
  var facts = {
    file: {
      name: root.name || '', url: '', scope: scopeRaw, pages: [], fonts: [],
      componentNames: Object.keys(componentNames),
    },
    frames: [],
    nodes: [],
    // Counted over every node the walk visited, whether or not it was
    // returned. facts.nodes.length is the sample; totals.nodes is the file.
    totals: { nodes: 0, kept: 0, byType: {} },
    // sampled[reason] = { matched, kept }. A rule whose matched exceeds its
    // kept produced findings from a sample, and the report has to say so
    // rather than let a reader count the blocks and believe that is all.
    limits: { maxNodes: maxNodes, maxPerReason: MAX_PER_REASON, truncated: false, sampled: {} },
  };
  var totals = facts.totals;
  var sampled = facts.limits.sampled;
  var fontKeys = {};
  var pages = (root.children || []).filter(function (c) { return c.type === 'PAGE'; });

  pages.forEach(function (page) {
    var pageInScope = !scope || inScopeName(page.name);
    var contributed = false;

    // facts.frames means SCREENS, and only a FRAME is a screen. Collecting
    // every top-level page child instead made component sets, sections, cover
    // stickies and annotations into "frames" with widths - so a Components
    // page holding a 200px Button and a 360px Card faked mobile and tablet
    // tiers, silencing RS002 (the only Blocker rule) on a desktop-only file,
    // and a 1440px component set fired RS003 as a false positive.
    //
    // SECTIONs are descended into rather than skipped: a section-organised
    // file would otherwise yield an EMPTY facts.frames, and RS002 would go
    // silent again via its !facts.frames.length guard. The SECTION node
    // itself is not recorded - it is an organisational container with no
    // layout semantics, and recording it would make its frame children look
    // like the children of a frame with no Auto Layout (a false AL002).
    //
    // Non-frame page children are still WALKED into facts.nodes: components
    // need auditing too. Only facts.frames is filtered.
    var handleTop = function (top, inherited) {
      var ok = inherited || !scope || inScopeName(top.name);
      if (top.type === 'SECTION') {
        (top.children || []).forEach(function (c) { handleTop(c, ok); });
        return;
      }
      if (!ok) return;
      contributed = true;
      if (top.type === 'FRAME') {
        facts.frames.push({
          id: top.id, name: top.name, page: page.name,
          width: top.width, height: top.height,
        });
      }
      walkTop(top);
    };

    var walkTop = function (frame) {
      // Ancestors of a kept node are kept too, and only then: A11Y001 walks up
      // the parent chain looking for the effective background fill, and the
      // engine's byId map has to be able to follow it. The chain is exactly
      // the DFS stack, so it costs one flush rather than a second pass.
      var stack = [];
      var walk = function (node, parentId, depth) {
        if (totals.nodes >= maxNodes) { facts.limits.truncated = true; return; }
        totals.nodes += 1;
        totals.byType[node.type] = (totals.byType[node.type] || 0) + 1;

        var fam = node.fontName && node.fontName.family ? node.fontName.family : null;
        var sty = node.fontName && node.fontName.style ? node.fontName.style : null;
        if (fam) {
          var key = fam + '|' + sty;
          if (!fontKeys[key]) {
            fontKeys[key] = true;
            facts.file.fonts.push({ family: fam, style: sty });
          }
        }

        var children = node.children || [];
        var absKids = 0;
        for (var ci = 0; ci < children.length; ci++) {
          if (children[ci].layoutPositioning === 'ABSOLUTE') absKids += 1;
        }

        var rec = {
          id: node.id, name: node.name, type: node.type,
          page: page.name, frame: frame.name, parentId: parentId, depth: depth,
          x: node.x, y: node.y, width: node.width, height: node.height,
          visible: node.visible !== false,
          opacity: typeof node.opacity === 'number' ? node.opacity : 1,
          // The Plugin API returns the STRING 'NONE' for a frame with Auto
          // Layout off, never null. Passing that through gave rules two
          // shapes to test for, and the one they tested for ('falsy') was
          // the one a frame never has - so AL002 could only ever match a
          // GROUP. Normalise to null once, here, at the source.
          layoutMode: node.layoutMode && node.layoutMode !== 'NONE' ? node.layoutMode : null,
          layoutSizingHorizontal: node.layoutSizingHorizontal || null,
          layoutSizingVertical: node.layoutSizingVertical || null,
          layoutPositioning: node.layoutPositioning || null,
          constraints: node.constraints || null,
          itemSpacing: typeof node.itemSpacing === 'number' ? node.itemSpacing : null,
          paddingLeft: typeof node.paddingLeft === 'number' ? node.paddingLeft : null,
          paddingRight: typeof node.paddingRight === 'number' ? node.paddingRight : null,
          paddingTop: typeof node.paddingTop === 'number' ? node.paddingTop : null,
          paddingBottom: typeof node.paddingBottom === 'number' ? node.paddingBottom : null,
          textAutoResize: node.textAutoResize || null,
          charCount: typeof node.characters === 'string' ? node.characters.length : null,
          fontFamily: fam, fontStyle: sty,
          fontSize: typeof node.fontSize === 'number' ? node.fontSize : null,
          isInstance: node.type === 'INSTANCE',
          mainComponentId: node.mainComponent ? node.mainComponent.id : null,
          mainComponentName: node.mainComponent ? node.mainComponent.name : null,
          nameMatchesComponent: DETACH_SUSPECT_TYPES[node.type] === true
            && componentNames[node.name] === true,
          overrideCount: Array.isArray(node.overrides) ? node.overrides.length : 0,
          componentPropertyCount: propCount(node),
          variantProperties: node.variantProperties || null,
          fills: paints(node.fills),
          strokes: paints(node.strokes),
          effects: effectsOf(node),
          blendMode: node.blendMode || null,
          isMask: !!node.isMask,
          exportSettings: exportsOf(node),
          hasImageFill: Array.isArray(node.fills)
            && node.fills.some(function (f) { return f.type === 'IMAGE'; }),
          outOfBounds: node !== frame && escapesFrame(node, frame),
          fractional: isFractional(node),
          // AL002 used to count a node's children by grouping facts.nodes on
          // parentId. Under reduction those children may not be in the array,
          // so the count is taken here, where the tree still is.
          childCount: children.length,
          absChildCount: absKids,
        };

        var reasons = keepReasons(rec);
        var keep = !reduce;
        for (var ri = 0; ri < reasons.length; ri++) {
          var s = sampled[reasons[ri]] || (sampled[reasons[ri]] = { matched: 0, kept: 0 });
          s.matched += 1;
          if (reasons[ri] === 'context' || s.kept < MAX_PER_REASON) keep = true;
        }
        if (keep) {
          for (var rj = 0; rj < reasons.length; rj++) sampled[reasons[rj]].kept += 1;
          for (var si = 0; si < stack.length; si++) {
            if (!stack[si].pushed) { facts.nodes.push(stack[si].rec); stack[si].pushed = true; }
          }
          facts.nodes.push(rec);
        }
        stack.push({ rec: rec, pushed: keep });

        // Record the hidden node (it may still export) but do not walk into it:
        // its subtree is not part of the delivered design.
        if (node.visible !== false) {
          for (var k = 0; k < children.length; k++) walk(children[k], node.id, depth + 1);
        }
        stack.pop();
      };

      walk(frame, page.id, 0);
    };

    // A scope that names the PAGE puts every top-level child in scope.
    (page.children || []).forEach(function (top) { handleTop(top, pageInScope); });
    if (pageInScope || contributed) facts.file.pages.push(page.name);
  });

  totals.kept = facts.nodes.length;
  return facts;
}

// use_figma entry point: the last expression is the returned value.
//
// loadAllPagesAsync() runs first. Under dynamic-page document access an
// unvisited page's children are not populated, so without it the walk
// silently reports an almost-empty file - the worst possible failure, since
// it looks like a clean audit. Guarded with a capability check so older API
// versions (where the call does not exist) still work.
//
// TWT_SCOPE is the ONE knob the caller may set, by prepending a single
// `var TWT_SCOPE = "<name>";` line ahead of this file's contents. The file
// body itself is still passed verbatim - a scan that drifts between runs
// produces findings that drift between runs.
//
// collectFacts itself stays synchronous, so tests call it directly.
typeof figma !== 'undefined'
  ? (figma.loadAllPagesAsync ? figma.loadAllPagesAsync() : Promise.resolve())
      .then(function () {
        var scope = typeof TWT_SCOPE !== 'undefined' ? TWT_SCOPE : null;
        return JSON.stringify(collectFacts(figma.root, { scope: scope }));
      })
  : null;
