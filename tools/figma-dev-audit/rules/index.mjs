// Rule registry. Each rule group is its own module so no single file holds
// every rule; groups are appended here as they land.
import { layoutRules } from './layout.mjs';
import { componentRules } from './components.mjs';
import { assetRules } from './assets.mjs';

export const RULES = [...layoutRules, ...componentRules, ...assetRules];
