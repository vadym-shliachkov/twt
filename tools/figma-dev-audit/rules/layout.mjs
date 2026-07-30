// Layout and responsive rules. These are the highest-value deterministic
// checks: a fixed-height text box or a missing breakpoint tier costs more
// developer time than every naming problem in the file combined.
import { finding } from '../../figma-dev-audit.mjs';

const CAT_AL = 'Auto Layout & sizing';
const CAT_RS = 'Responsive coverage';

// Enough copy that wrapping is realistic. Badges and numerals below this
// threshold are legitimately fixed-height.
const LONG_TEXT = 20;

export const tierOf = (w) => (w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop');

// "Home / Desktop", "Home - mobile", "Home@1440" all reduce to "home".
export const screenKey = (name) => {
  const raw = String(name).trim().toLowerCase();
  const stripped = raw
    .replace(/[/\-–—@]\s*(desktop|mobile|tablet|tab|sm|md|lg|xl|\d{3,4})\s*$/i, '')
    .trim();
  // A name that is nothing but a separator and a tier token ("/Desktop",
  // "-Mobile", "@1440") strips to "". Every such frame would then collapse
  // into one key, and RS003 would read that as full tier coverage and
  // suppress a real finding. Fall back to the unstripped name.
  return stripped || raw;
};

export const layoutRules = [
  {
    id: 'AL001',
    run(facts) {
      return facts.nodes
        .filter((n) => n.type === 'TEXT' && n.textAutoResize === 'NONE' && (n.charCount || 0) >= LONG_TEXT)
        .map((n) => finding({
          rule: 'AL001', category: CAT_AL, severity: 'High', confidence: 'High', owner: 'Designer',
          title: 'Fixed-height text container',
          nodeIds: [n.id],
          detected: `Text layer "${n.name}" holds ${n.charCount} characters with textAutoResize NONE, so the box does not grow with its content.`,
        }));
    },
  },
  {
    id: 'AL002',
    run(facts) {
      const kids = new Map();
      for (const n of facts.nodes) {
        if (!n.parentId) continue;
        if (!kids.has(n.parentId)) kids.set(n.parentId, []);
        kids.get(n.parentId).push(n);
      }
      // Child counts come from the scan when it provides them, and only
      // otherwise from grouping facts.nodes on parentId. The scan returns a
      // reduced node set on any file big enough to matter, so a node's
      // children are frequently absent from the array - counting them here
      // would read 0 and this rule would go silent on exactly the large,
      // messy files it exists for. The grouped fallback keeps an older
      // facts.json readable.
      const count = (n) => (typeof n.childCount === 'number' ? n.childCount : (kids.get(n.id) || []).length);
      const allAbsolute = (n) => (typeof n.absChildCount === 'number'
        ? n.absChildCount === n.childCount
        : (kids.get(n.id) || []).every((c) => c.layoutPositioning === 'ABSOLUTE'));

      // Both shapes are tested on purpose. scan.js normalises Figma's
      // 'NONE' to null at the source, but this rule must be correct against
      // a facts.json produced by any version of the scan - the version that
      // only checked falsiness silently never fired on a single frame.
      return facts.nodes
        .filter((n) => (!n.layoutMode || n.layoutMode === 'NONE') && count(n) >= 3 && !allAbsolute(n))
        .map((n) => finding({
          rule: 'AL002', category: CAT_AL, severity: 'Medium', confidence: 'High', owner: 'Designer',
          title: 'Multi-child frame without Auto Layout',
          nodeIds: [n.id],
          detected: `"${n.name}" holds ${count(n)} children with no Auto Layout, so spacing and reflow have to be inferred rather than read.`,
        }));
    },
  },
  {
    id: 'AL003',
    run(facts) {
      return facts.nodes
        .filter((n) => n.type === 'RECTANGLE' && /spacer|gap|spacing/i.test(n.name) && n.fills.length === 0)
        .map((n) => finding({
          rule: 'AL003', category: CAT_AL, severity: 'Low', confidence: 'High', owner: 'Designer',
          title: 'Spacer rectangle used for spacing',
          nodeIds: [n.id],
          detected: `"${n.name}" is an empty rectangle standing in for spacing that Auto Layout gap should express.`,
        }));
    },
  },
  {
    id: 'RS001',
    run(facts) {
      return facts.nodes
        .filter((n) => n.outOfBounds)
        .map((n) => finding({
          rule: 'RS001', category: CAT_RS, severity: 'High', confidence: 'High', owner: 'Designer',
          title: 'Layer overflows its frame',
          nodeIds: [n.id],
          detected: `"${n.name}" extends past the bounds of frame "${n.frame}", so the intended clipping or bleed behaviour is undefined.`,
        }));
    },
  },
  {
    id: 'RS002',
    run(facts) {
      const tiers = new Set((facts.frames || []).map((f) => tierOf(f.width)));
      if (tiers.size > 1 || !facts.frames?.length) return [];
      return [finding({
        rule: 'RS002', category: CAT_RS, severity: 'Blocker', confidence: 'High', owner: 'Designer',
        title: 'Only one breakpoint tier in the file',
        nodeIds: [facts.frames[0].id],
        detected: `Every frame sits in the ${[...tiers][0]} tier. There is no second layout to derive responsive behaviour from.`,
      })];
    },
  },
  {
    id: 'RS003',
    run(facts) {
      const byKey = new Map();
      for (const f of facts.frames || []) {
        const k = screenKey(f.name);
        if (!byKey.has(k)) byKey.set(k, new Set());
        byKey.get(k).add(tierOf(f.width));
      }
      const covered = new Set();
      for (const tiers of byKey.values()) for (const t of tiers) covered.add(t);
      if (covered.size < 2) return []; // RS002 already owns this case.

      const out = [];
      for (const [key, tiers] of byKey) {
        if (tiers.has('desktop') && !tiers.has('mobile')) {
          const frame = facts.frames.find((f) => screenKey(f.name) === key);
          out.push(finding({
            rule: 'RS003', category: CAT_RS, severity: 'High', confidence: 'High', owner: 'Designer',
            title: 'Screen has no mobile counterpart',
            nodeIds: [frame.id],
            detected: `"${frame.name}" exists at desktop only. Its mobile layout has to be invented during build.`,
          }));
        }
      }
      return out;
    },
  },
];
