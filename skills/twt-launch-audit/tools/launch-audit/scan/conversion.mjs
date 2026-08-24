// tools/launch-audit/scan/conversion.mjs — category 6.
//
// A form posting to "#" is the quietest launch failure there is: the page looks
// finished, the button animates, and every lead is discarded. No existing twt
// audit checks a form's destination.
import { NONPROD_URL_AT_START } from './lib/patterns.mjs';

const FORM = /<form\b[^>]*>[\s\S]*?<\/form>/gi;
// The non-production host list is SHARED with hygiene.mjs (scan/lib/
// patterns.mjs). This module's private copy omitted 0.0.0.0 and .local, so a
// form posting to http://0.0.0.0:8080/post — the exact "quietest launch
// failure" the comment above describes — slipped past this LAUNCH-BLOCKER and
// was caught only by hygiene's FIX-WEEK-ONE nonprod_url sweep. Two definitions
// of one term, and the narrower one guarded the higher severity.
//
// Applied ANCHORED here, because a form `action` IS the destination: a match
// has to cover the start of the URL, not merely appear somewhere inside it.

export function run(ctx) {
  const counts = {
    forms: 0, dead_actions: 0, nonprod_actions: 0,
    unlabeled_controls: 0, no_submit: 0, bad_mailto: 0, bad_tel: 0,
  };
  const findings = [];

  for (const f of ctx.html) {
    const src = ctx.read(f);
    const file = ctx.rel(f);

    for (const m of src.matchAll(FORM)) {
      counts.forms++;
      const form = m[0];
      const line = ctx.lineOf(src, m.index);
      const act = /\saction\s*=\s*["']([^"']*)["']/i.exec(form);
      const action = act ? act[1].trim() : '';

      // No action attribute at all posts to the current URL — for a static build
      // that is a page, not an endpoint, so it is as dead as "#".
      if (!action || action === '#') {
        counts.dead_actions++;
        findings.push({ kind: 'dead_action', file, line, detail: act ? `action="${action}"` : 'no action attribute' });
      } else if (NONPROD_URL_AT_START.test(action)) {
        counts.nonprod_actions++;
        findings.push({ kind: 'nonprod_action', file, line, detail: `action="${action}"` });
      }

      if (!/<(?:button[^>]*type\s*=\s*["']submit["']|button(?![^>]*\stype=)|input[^>]*type\s*=\s*["']submit["'])/i.test(form)) {
        counts.no_submit++;
        findings.push({ kind: 'no_submit', file, line, detail: 'form has no submit control' });
      }

      // A control is labeled by aria-label, aria-labelledby, a title, a
      // <label for> pointing at its id, or by being nested inside a wrapping
      // <label>...</label> with no for/id at all — that is valid, common HTML
      // (e.g. `<label>Email <input name="e"></label>`), and treating it as
      // unlabeled would be a false positive on entirely accessible markup.
      // Hidden and submit inputs are exempt.
      const labelFor = new Set([...form.matchAll(/<label\b[^>]*\sfor\s*=\s*["']([^"']+)["']/gi)].map((x) => x[1]));
      const labelSpans = [...form.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/gi)]
        .map((x) => [x.index, x.index + x[0].length]);
      const insideLabel = (idx) => labelSpans.some(([s, e]) => idx >= s && idx < e);
      for (const c of form.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
        const tag = c[0];
        if (/type\s*=\s*["'](hidden|submit|button|image)["']/i.test(tag)) continue;
        const id = /\sid\s*=\s*["']([^"']+)["']/i.exec(tag);
        const labeled = /\saria-label(?:ledby)?\s*=\s*["'][^"']+["']/i.test(tag)
          || /\stitle\s*=\s*["'][^"']+["']/i.test(tag)
          || (id && labelFor.has(id[1]))
          || insideLabel(c.index);
        if (labeled) continue;
        counts.unlabeled_controls++;
        findings.push({ kind: 'unlabeled_control', file, line: ctx.lineOf(src, m.index + c.index), detail: tag.slice(0, 60) });
      }
    }

    for (const m of src.matchAll(/href\s*=\s*["']mailto:([^"']*)["']/gi)) {
      if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(m[1].split('?')[0].trim())) continue;
      counts.bad_mailto++;
      findings.push({ kind: 'bad_mailto', file, line: ctx.lineOf(src, m.index), detail: `mailto:${m[1]}` });
    }
    for (const m of src.matchAll(/href\s*=\s*["']tel:([^"']*)["']/gi)) {
      if (/^\+?[\d\s().-]{7,}$/.test(m[1].trim())) continue;
      counts.bad_tel++;
      findings.push({ kind: 'bad_tel', file, line: ctx.lineOf(src, m.index), detail: `tel:${m[1]}` });
    }
  }
  return { counts, findings };
}
