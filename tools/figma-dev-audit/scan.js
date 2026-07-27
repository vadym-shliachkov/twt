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

// x/y on SceneNode are relative to the *immediate* parent, not the canvas,
// so they are only directly comparable to another node's x/y when both
// share the same parent. absoluteBoundingBox puts a node's box in canvas
// space, which is what a top-level frame and any of its descendants (at
// any depth, under any nested parent) can be safely compared in. Fall back
// to the local box only when absoluteBoundingBox is unavailable (e.g. a
// duck-typed fixture that does not set it) - that fallback is only valid
// for a frame at canvas origin, but it is better than throwing.
function boxOf(node) {
  return node.absoluteBoundingBox || { x: node.x, y: node.y, width: node.width, height: node.height };
}

// A node is out of bounds when its box escapes its owning top-level frame.
// 0.5px tolerance absorbs Figma's sub-pixel rounding.
function escapesFrame(node, frameBox) {
  if (!frameBox) return false;
  var t = 0.5;
  var box = boxOf(node);
  return (
    box.x < frameBox.x - t ||
    box.y < frameBox.y - t ||
    box.x + box.width > frameBox.x + frameBox.width + t ||
    box.y + box.height > frameBox.y + frameBox.height + t
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
      var frameBox = boxOf(frame);
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
          outOfBounds: node !== frame && escapesFrame(node, frameBox),
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
