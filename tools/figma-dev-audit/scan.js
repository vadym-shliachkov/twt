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

function collectFacts(root) {
  var componentNames = collectComponentNames(root, {});
  var facts = {
    file: {
      name: root.name || '', url: '', pages: [], fonts: [],
      componentNames: Object.keys(componentNames),
    },
    frames: [],
    nodes: [],
  };
  var fontKeys = {};
  var pages = (root.children || []).filter(function (c) { return c.type === 'PAGE'; });

  pages.forEach(function (page) {
    facts.file.pages.push(page.name);

    (page.children || []).forEach(function (frame) {
      facts.frames.push({
        id: frame.id, name: frame.name, page: page.name,
        width: frame.width, height: frame.height,
      });

      var walk = function (node, parentId, depth) {
        var fam = node.fontName && node.fontName.family ? node.fontName.family : null;
        var sty = node.fontName && node.fontName.style ? node.fontName.style : null;
        if (fam) {
          var key = fam + '|' + sty;
          if (!fontKeys[key]) {
            fontKeys[key] = true;
            facts.file.fonts.push({ family: fam, style: sty });
          }
        }

        facts.nodes.push({
          id: node.id, name: node.name, type: node.type,
          page: page.name, frame: frame.name, parentId: parentId, depth: depth,
          x: node.x, y: node.y, width: node.width, height: node.height,
          visible: node.visible !== false,
          opacity: typeof node.opacity === 'number' ? node.opacity : 1,
          layoutMode: node.layoutMode || null,
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
        });

        // Record the hidden node (it may still export) but do not walk into it:
        // its subtree is not part of the delivered design.
        if (node.visible === false) return;
        (node.children || []).forEach(function (child) {
          walk(child, node.id, depth + 1);
        });
      };

      walk(frame, page.id, 0);
    });
  });

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
// collectFacts itself stays synchronous, so tests call it directly.
typeof figma !== 'undefined'
  ? (figma.loadAllPagesAsync ? figma.loadAllPagesAsync() : Promise.resolve())
      .then(function () { return JSON.stringify(collectFacts(figma.root)); })
  : null;
