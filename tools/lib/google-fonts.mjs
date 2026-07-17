// google-fonts.mjs — build <link> tags for the PROJECT's own font tokens.
//
// gen-preview.mjs / gen-gallery.mjs ship a fixed Google Fonts link for their
// chrome (Inter / IBM Plex Mono / Montserrat headings). Specimens, however,
// render in the project's --font-family-* tokens at the project's
// --font-weight-* values — and those weights were never guaranteed to be
// loaded (a body specimen at weight 400 silently rendered with the chrome's
// 600 file). This helper reads the tokens.css text and emits one extra
// stylesheet <link> per project family carrying every token weight, so
// specimens render at their true weights.
//
// Each family gets its OWN <link>: Google Fonts css2 rejects the whole request
// when any one family is unknown, so isolating families means a non-Google
// font degrades alone instead of taking the chrome fonts down with it.

const GENERIC_FAMILIES = new Set([
  'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'math',
  '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'inherit', 'initial',
]);

// First concrete family of every family-carrying token: --font-family-*,
// --ff-*, or a bare --font / --font-<role> that isn't size/weight/etc.
export function projectFamilies(cssText) {
  const fams = new Set();
  const re = /--(?:font-family[\w-]*|ff(?:-[\w-]+)?|font(?:-(?!size|weight|style|stretch|variant|feature)[\w-]+)?)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(cssText))) {
    const first = m[1].split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (!first || /var\(/i.test(first)) continue;
    if (/^[\d.]|(?:rem|px|em|%)\b|clamp\(/i.test(first)) continue; // a length/number, not a family
    if (GENERIC_FAMILIES.has(first.toLowerCase())) continue;
    fams.add(first);
  }
  return [...fams];
}

// Every numeric --font-weight / --fw token value (300–900); default 400+700.
export function projectWeights(cssText) {
  const weights = new Set();
  const re = /--(?:font-weight|fw)[\w-]*\s*:\s*(\d{3})\s*[;!]/gi;
  let m;
  while ((m = re.exec(cssText))) {
    const w = parseInt(m[1], 10);
    if (w >= 100 && w <= 900) weights.add(w);
  }
  if (!weights.size) { weights.add(400); weights.add(700); }
  return [...weights].sort((a, b) => a - b);
}

// <link> tags for the project's families/weights. `covered` maps a lowercase
// family already loaded by the caller's chrome link to the weights it carries;
// a project family whose weights are all covered emits nothing.
export function projectFontLinks(cssText, covered = {}) {
  const weights = projectWeights(cssText);
  const links = [];
  for (const fam of projectFamilies(cssText)) {
    const have = new Set(covered[fam.toLowerCase()] || []);
    const need = weights.filter((w) => !have.has(w));
    if (!need.length) continue;
    const all = [...new Set([...have, ...need])].sort((a, b) => a - b);
    const famParam = fam.trim().replace(/\s+/g, '+');
    links.push(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${famParam}:wght@${all.join(';')}&display=swap">`);
  }
  return links.join('\n');
}
