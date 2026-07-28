// Asset, effect and file-hygiene rules.
//
// Effects are graded by implementation cost, not by taste: a drop shadow is
// one CSS line, a backdrop blur is a browser-support conversation, and a
// blend mode over live content usually is not reproducible in CSS at all.
import { finding } from '../../figma-dev-audit.mjs';

const CAT_AS = 'Assets & exports';
const CAT_FX = 'Effects & implementation cost';
const CAT_HY = 'Handoff hygiene';

const RASTER = /^(PNG|JPG)$/i;
const VECTORISH = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE']);
const PLAIN_BLEND = new Set(['PASS_THROUGH', 'NORMAL', null]);

export const assetRules = [
  {
    id: 'AS001',
    run(facts) {
      return facts.nodes
        .filter((n) => n.hasImageFill && n.exportSettings.length === 0)
        .map((n) => finding({
          rule: 'AS001', category: CAT_AS, severity: 'Medium', confidence: 'High', owner: 'Designer',
          title: 'Image fill with no export settings',
          nodeIds: [n.id],
          detected: `"${n.name}" carries an image fill but no export setting, so format and scale are undecided at handoff.`,
        }));
    },
  },
  {
    id: 'AS002',
    run(facts) {
      return facts.nodes
        .filter((n) => VECTORISH.has(n.type) && n.exportSettings.some((e) => RASTER.test(e.format || '')))
        .map((n) => finding({
          rule: 'AS002', category: CAT_AS, severity: 'Medium', confidence: 'High', owner: 'Designer',
          title: 'Vector artwork exported as raster',
          nodeIds: [n.id],
          detected: `"${n.name}" is vector geometry set to export as ${n.exportSettings.map((e) => e.format).join('/')}, losing scalability for no benefit.`,
        }));
    },
  },
  {
    id: 'FX001',
    run(facts) {
      return facts.nodes
        .filter((n) => n.effects.some((e) => e.type === 'BACKGROUND_BLUR' || e.type === 'LAYER_BLUR'))
        .map((n) => finding({
          rule: 'FX001', category: CAT_FX, severity: 'Medium', confidence: 'High', owner: 'Developer',
          title: 'Blur effect needs a browser-support decision',
          nodeIds: [n.id],
          detected: `"${n.name}" uses ${n.effects.filter((e) => /BLUR/.test(e.type)).map((e) => e.type).join(', ')}. backdrop-filter is implementable but needs a documented fallback.`,
        }));
    },
  },
  {
    id: 'FX002',
    run(facts) {
      return facts.nodes
        .filter((n) => !PLAIN_BLEND.has(n.blendMode) || (n.isMask && n.type !== 'FRAME'))
        .map((n) => finding({
          rule: 'FX002', category: CAT_FX, severity: 'High', confidence: 'High', owner: 'Developer',
          title: n.isMask ? 'Mask needs custom implementation' : 'Blend mode needs custom implementation',
          nodeIds: [n.id],
          detected: n.isMask
            ? `"${n.name}" is a mask on a ${n.type} node. CSS mask support varies and the intended result may need SVG or a pre-rendered asset.`
            : `"${n.name}" uses blend mode ${n.blendMode}. mix-blend-mode over live content is not reliably reproducible and may need a flattened asset.`,
        }));
    },
  },
  {
    id: 'HY001',
    run(facts) {
      return facts.nodes
        .filter((n) => !n.visible && n.exportSettings.length > 0)
        .map((n) => finding({
          rule: 'HY001', category: CAT_HY, severity: 'Medium', confidence: 'High', owner: 'Designer',
          title: 'Hidden layer marked for export',
          nodeIds: [n.id],
          detected: `"${n.name}" is hidden but still carries export settings, so it will ship in a bulk export nobody expects it in.`,
        }));
    },
  },
  {
    id: 'HY002',
    run(facts) {
      return facts.nodes.filter((n) => n.fractional).map((n) => finding({
        rule: 'HY002', category: CAT_HY, severity: 'Low', confidence: 'High', owner: 'Designer',
        title: 'Fractional coordinates or dimensions',
        nodeIds: [n.id],
        detected: `"${n.name}" sits on sub-pixel geometry, which renders soft and produces measurement values nobody can reproduce.`,
      }));
    },
  },
];
