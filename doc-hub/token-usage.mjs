export const TOKEN_USAGE_LEVELS = Object.freeze(['low', 'mid', 'high', 'very-high']);

export const TOKEN_USAGE_GUIDE = Object.freeze([
  Object.freeze({
    key: 'low',
    label: 'Low',
    segments: 1,
    windowImpact: '1–5%',
    description: 'A narrow, mostly deterministic task. Many runs should fit in one usage window.',
  }),
  Object.freeze({
    key: 'mid',
    label: 'Mid',
    segments: 2,
    windowImpact: '5–20%',
    description: 'A focused workflow that reads context, reasons about it, and produces a bounded result.',
  }),
  Object.freeze({
    key: 'high',
    label: 'High',
    segments: 3,
    windowImpact: '20–60%',
    description: 'A broad or multi-step workflow that may inspect several sources or dispatch sub-skills.',
  }),
  Object.freeze({
    key: 'very-high',
    label: 'Very high',
    segments: 4,
    windowImpact: '60–100%+',
    description: 'A full pipeline or deep audit that may use most of a window or continue into another one.',
  }),
]);

const LEVEL_META = Object.freeze(Object.fromEntries(
  TOKEN_USAGE_GUIDE.map(({ key, label, segments }) => [key, Object.freeze({ label, segments })]),
));

// Qualitative estimates for a typical complete command run, including any
// sub-skills it dispatches. Keep this explicit: reads/writes counts do not
// reliably predict model work, iteration, or orchestration depth.
export const TOKEN_USAGE_BY_SKILL = Object.freeze({
  'twt-assets-produce': 'high',
  'twt-audience': 'high',
  'twt-block-preview': 'low',
  'twt-brand': 'high',
  'twt-brand-fetch': 'mid',
  'twt-component-define': 'high',
  'twt-component-validate': 'mid',
  'twt-content-approval-checklist': 'high',
  'twt-content-approval-implement': 'high',
  'twt-content-fetch': 'high',
  'twt-content-fetch-doc': 'mid',
  'twt-content-fetch-figma': 'mid',
  'twt-content-fetch-pdf': 'mid',
  'twt-content-fetch-site': 'mid',
  'twt-content-optimize': 'mid',
  'twt-content-validate': 'mid',
  'twt-curation-define': 'high',
  'twt-curation-validate': 'mid',
  'twt-design': 'very-high',
  'twt-design-system': 'high',
  'twt-design-system-audit': 'very-high',
  'twt-develop': 'very-high',
  'twt-direction-define': 'high',
  'twt-elementor-block-creator': 'high',
  'twt-elementor-theme-creator': 'mid',
  'twt-eval-smoke': 'mid',
  'twt-export': 'mid',
  'twt-export-docx': 'low',
  'twt-export-pdf': 'low',
  'twt-export-presentation': 'low',
  'twt-export-template-create': 'mid',
  'twt-figma-design-system': 'high',
  'twt-figma-mockup': 'high',
  'twt-html-block-creator': 'high',
  'twt-html-site-creator': 'mid',
  'twt-ia-define': 'mid',
  'twt-ia-validate': 'mid',
  'twt-layout-define': 'mid',
  'twt-layout-validate': 'mid',
  'twt-marketplace-docs': 'low',
  'twt-mockup-define': 'high',
  'twt-mockup-validate': 'mid',
  'twt-positioning': 'high',
  'twt-pre-design': 'very-high',
  'twt-project-intake': 'mid',
  'twt-qa': 'high',
  'twt-qa-a11y': 'mid',
  'twt-qa-content': 'mid',
  'twt-qa-design': 'mid',
  'twt-qa-elementor': 'mid',
  'twt-qa-links': 'mid',
  'twt-search-site': 'low',
  'twt-seo': 'high',
  'twt-setup': 'low',
  'twt-site': 'very-high',
  'twt-site-dev': 'very-high',
  'twt-spec': 'high',
  'twt-status': 'low',
  'twt-text-analysis': 'mid',
  'twt-wiki': 'high',
  'twt-wiki-fetch': 'mid',
  'twt-wiki-query': 'mid',
});

export function tokenUsageFor(slug) {
  const key = TOKEN_USAGE_BY_SKILL[slug];
  const meta = LEVEL_META[key];
  if (!meta) throw new Error(`Missing token-usage estimate for ${slug}`);
  return { key, ...meta };
}
