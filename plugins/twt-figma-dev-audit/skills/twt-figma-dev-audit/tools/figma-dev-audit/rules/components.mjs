// Component and code-mapping rules.
//
// BOUNDARY: duplicate and near-duplicate component detection belongs to
// /twt-design-system-audit. Nothing here clusters or compares components for
// similarity - this module only asks whether an instance maps cleanly onto a
// code component.
import { finding } from '../../figma-dev-audit.mjs';

const CAT = 'Components & code mapping';
const CAT_HY = 'Handoff hygiene';

// Past this, the instance has diverged so far from its main component that it
// is effectively a new component wearing the old one's name.
const HEAVY_OVERRIDES = 8;
const INTERACTIVE = /button|input|field|card|chip|tag|badge/i;
const DEFAULT_NAME = /^(Frame|Group|Rectangle|Component) \d+$|^Copy \d+$/;

export const componentRules = [
  {
    id: 'CM001',
    // Confidence: Medium on purpose. The Plugin API leaves no detachment
    // marker, so this reads a name collision - a frame wearing a component's
    // name. That is strong evidence, not proof, and the report must not
    // present it as measured.
    run(facts) {
      return facts.nodes.filter((n) => n.nameMatchesComponent).map((n) => finding({
        rule: 'CM001', category: CAT, severity: 'High', confidence: 'Medium', owner: 'Designer',
        title: 'Likely detached component instance',
        nodeIds: [n.id],
        detected: `"${n.name}" is a plain ${n.type} carrying the name of a component in this file, which is what a detached instance leaves behind. If it was detached, it no longer tracks the component it was built from.`,
      }));
    },
  },
  {
    id: 'CM002',
    run(facts) {
      return facts.nodes
        .filter((n) => n.isInstance && n.overrideCount >= HEAVY_OVERRIDES)
        .map((n) => finding({
          rule: 'CM002', category: CAT, severity: 'Medium', confidence: 'High', owner: 'Designer',
          title: 'Instance with heavy override load',
          nodeIds: [n.id],
          detected: `"${n.name}" carries ${n.overrideCount} overrides. At that depth the instance no longer describes the component it points at.`,
        }));
    },
  },
  {
    id: 'CM003',
    run(facts) {
      return facts.nodes
        .filter((n) => n.type === 'COMPONENT' && INTERACTIVE.test(n.name)
          && n.componentPropertyCount === 0 && !n.variantProperties)
        .map((n) => finding({
          rule: 'CM003', category: CAT, severity: 'Medium', confidence: 'High', owner: 'Designer',
          title: 'Interactive component without variants or properties',
          nodeIds: [n.id],
          detected: `"${n.name}" exposes no component properties and no variants, so its states and content slots have to be guessed in code.`,
        }));
    },
  },
  {
    id: 'CM004',
    run(facts) {
      return facts.nodes.filter((n) => DEFAULT_NAME.test(n.name)).map((n) => finding({
        rule: 'CM004', category: CAT_HY, severity: 'Low', confidence: 'High', owner: 'Designer',
        title: 'Default layer name',
        nodeIds: [n.id],
        detected: `"${n.name}" carries Figma's default name, giving the developer no signal about its role.`,
      }));
    },
  },
];
