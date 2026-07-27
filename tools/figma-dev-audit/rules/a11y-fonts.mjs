// Font inventory, contrast and touch-target rules.
//
// Font LICENSING is deliberately absent from the findings: it is not in the
// file, so it can only ever be a Confidence: Low guess. It goes to decisions[]
// as a question instead. This is the single rule that keeps the report honest.
//
// BOUNDARY: contrast as a design-system metric belongs to
// /twt-design-system-audit. Here it is checked only where it is a build risk -
// text and controls a user has to read or hit.
import { finding } from '../../figma-dev-audit.mjs';
// ratio() takes parsed {r,g,b,a} objects, NOT colour strings - passing a hex
// string returns NaN, and NaN >= min is false, so every text node would be
// reported as failing contrast. Always parseColor() first and skip when it
// returns null (it does not parse gradients, hsl, or keywords).
import { ratio, parseColor } from '../../lib/contrast.mjs';

const CAT_FN = 'Fonts';
const CAT_A11Y = 'Content flexibility & a11y risk';

// Fonts shipped with every OS, so no webfont licence conversation is needed.
const SYSTEM_FONTS = new Set([
  'arial', 'helvetica', 'helvetica neue', 'times new roman', 'georgia',
  'courier new', 'verdana', 'tahoma', 'trebuchet ms', 'segoe ui',
  'system-ui', 'sf pro text', 'sf pro display', 'roboto',
]);

const MAX_FAMILIES = 3;
const MAX_PAIRS = 6;
const MIN_TARGET = 44;         // WCAG 2.2 AA target size
const CONTROL = /button|icon|close|menu|toggle/i;

const solidHex = (n) => {
  const f = (n.fills || []).find((p) => p.type === 'SOLID' && p.hex && p.opacity === 1);
  return f ? f.hex : null;
};

export const a11yFontRules = [
  {
    id: 'FN001', category: CAT_FN,
    run() { return []; },        // licensing is never a finding
    decisions(facts) {
      const fams = [...new Set((facts.file?.fonts || []).map((f) => f.family))]
        .filter((f) => f && !SYSTEM_FONTS.has(f.toLowerCase()));
      return fams.map((family) => ({
        id: `FN001-${family}`,
        question: `Is there a webfont licence and are the font files available for ${family}?`,
        why: 'Licensing is not recorded in the Figma file, so it cannot be confirmed from the design. Substituting the family later changes line breaks, element heights and page length.',
        owner: 'Client',
      }));
    },
  },
  {
    id: 'FN002', category: CAT_FN,
    run(facts) {
      const fonts = facts.file?.fonts || [];
      const families = new Set(fonts.map((f) => f.family));
      if (families.size <= MAX_FAMILIES && fonts.length <= MAX_PAIRS) return [];
      return [finding({
        rule: 'FN002', category: CAT_FN, severity: 'Medium', confidence: 'High', owner: 'Designer',
        title: 'Large type inventory',
        nodeIds: [],
        detected: `The file uses ${families.size} font families across ${fonts.length} family/style pairs. Each pair is another file to license, host and load.`,
      })];
    },
  },
  {
    id: 'A11Y001', category: CAT_A11Y,
    run(facts, ctx) {
      const out = [];
      for (const n of facts.nodes) {
        if (n.type !== 'TEXT') continue;
        const fg = solidHex(n);
        if (!fg) continue;

        // Nearest ancestor with a solid fill is the effective background.
        let p = ctx.byId.get(n.parentId);
        let bg = null;
        while (p && !bg) { bg = solidHex(p); p = ctx.byId.get(p.parentId); }
        if (!bg) continue;

        const fgc = parseColor(fg);
        const bgc = parseColor(bg);
        if (!fgc || !bgc) continue;  // unparseable -> no contrast claim to make

        const r = ratio(fgc, bgc);
        const min = (n.fontSize || 16) >= 24 ? 3.0 : 4.5;
        if (r >= min) continue;

        out.push(finding({
          rule: 'A11Y001', category: CAT_A11Y, severity: 'High', confidence: 'High', owner: 'Designer',
          title: 'Text contrast below WCAG AA',
          nodeIds: [n.id],
          detected: `"${n.name}" renders ${fg} on ${bg} at ${r.toFixed(2)}:1, under the ${min}:1 minimum for ${n.fontSize || 16}px text.`,
        }));
      }
      return out;
    },
  },
  {
    id: 'A11Y002', category: CAT_A11Y,
    run(facts) {
      return facts.nodes
        .filter((n) => CONTROL.test(n.name) && (n.width < MIN_TARGET || n.height < MIN_TARGET))
        .map((n) => finding({
          rule: 'A11Y002', category: CAT_A11Y, severity: 'Medium', confidence: 'High', owner: 'Designer',
          title: 'Touch target below 44px',
          nodeIds: [n.id],
          detected: `"${n.name}" measures ${Math.round(n.width)}x${Math.round(n.height)}px, under the 44x44 minimum for a reliable touch target.`,
        }));
    },
  },
];
