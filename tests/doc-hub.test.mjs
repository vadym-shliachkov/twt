import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const skillsMarkdown = readFileSync(join(root, 'SKILLS.md'), 'utf8');
const skillSlugs = [...skillsMarkdown.matchAll(/^##\s+\/(twt-[^\n]+)/gm)]
  .map((match) => match[1].trim());
const tokenUsagePath = join(root, 'doc-hub', 'token-usage.mjs');

test('every documented skill has a valid token-usage estimate', async () => {
  assert.equal(existsSync(tokenUsagePath), true, 'token-usage registry must exist');

  const {
    TOKEN_USAGE_LEVELS,
    TOKEN_USAGE_BY_SKILL,
    tokenUsageFor,
  } = await import(pathToFileURL(tokenUsagePath));

  assert.ok(skillSlugs.length > 0, 'SKILLS.md must contain documented skills');

  for (const slug of skillSlugs) {
    assert.ok(
      TOKEN_USAGE_LEVELS.includes(TOKEN_USAGE_BY_SKILL[slug]),
      `${slug} must have a supported token-usage level`,
    );
    assert.ok(tokenUsageFor(slug).label, `${slug} must have a visible label`);
  }

  assert.throws(
    () => tokenUsageFor('twt-not-a-real-skill'),
    /Missing token-usage estimate for twt-not-a-real-skill/,
  );
});

test('generated overview and detail pages show the same token-usage estimate', async () => {
  const { tokenUsageFor } = await import(pathToFileURL(tokenUsagePath));
  const indexHtml = readFileSync(join(root, 'doc-hub', 'index.html'), 'utf8');

  assert.equal(
    (indexHtml.match(/class="token-usage-legend/g) || []).length,
    1,
    'the overview must explain the qualitative scale once',
  );

  for (const slug of skillSlugs) {
    const usage = tokenUsageFor(slug);
    const item = indexHtml.match(new RegExp(`<li[^>]*data-skill="${slug}"[\\s\\S]*?</li>`))?.[0];
    assert.ok(item, `${slug} must have a marked overview item`);
    assert.match(item, new RegExp(`data-token-usage="${usage.key}"`));
    assert.match(item, new RegExp(`aria-label="Token usage: ${usage.label}"`));

    const detail = readFileSync(join(root, 'doc-hub', 'skills', `${slug}.html`), 'utf8');
    assert.match(
      detail,
      new RegExp(`data-token-usage="${usage.key}"`),
      `${slug} detail page must match its overview estimate`,
    );
  }
});

test('marketplace explanation is one ordered vertical story', () => {
  const indexHtml = readFileSync(join(root, 'doc-hub', 'index.html'), 'utf8');

  assert.match(indexHtml, /class="marketplace-story/);
  assert.match(indexHtml, /marketplace-story__index"[^>]*>01<[\s\S]*What is a skills marketplace\?/);
  assert.match(indexHtml, /marketplace-story__index"[^>]*>02<[\s\S]*What this marketplace is for/);
  assert.ok(
    indexHtml.indexOf('What is a skills marketplace?')
      < indexHtml.indexOf('What this marketplace is for'),
    'definition must precede twt-specific scope',
  );
  assert.doesNotMatch(indexHtml, /detail-grid alt-intro-grid/);
  assert.doesNotMatch(
    indexHtml,
    /marketplace-story__step reveal/,
    'story content must stay visible without IntersectionObserver',
  );
});

test('index explains project knowledge, installation, and usage planning', () => {
  const indexHtml = readFileSync(join(root, 'doc-hub', 'index.html'), 'utf8');

  assert.match(indexHtml, /class="knowledge-guide"/);
  assert.match(indexHtml, /One project, one source of knowledge/);
  assert.match(indexHtml, />Project wiki</);
  assert.match(indexHtml, />Pipeline skills</);
  assert.match(indexHtml, />Single-task skills</);

  assert.match(indexHtml, /class="install-guide"/);
  assert.match(indexHtml, /\/plugin marketplace add vadym-shliachkov\/twt/);
  assert.match(indexHtml, /\/plugin install twt@twt-marketplace/);
  assert.match(indexHtml, /Restart Claude Code/);
  assert.match(indexHtml, /\/twt-setup/);

  for (const [level, impact] of [
    ['low', '1–5%'],
    ['mid', '5–20%'],
    ['high', '20–60%'],
    ['very-high', '60–100%+'],
  ]) {
    const row = indexHtml.match(
      new RegExp(`<li[^>]+data-usage-level="${level}"[\\s\\S]*?</li>`),
    )?.[0];
    assert.ok(row, `${level} must have a stacked usage-guide row`);
    assert.ok(row.includes(impact), `${level} must show its approximate 5-hour impact`);
  }

  assert.match(indexHtml, /planning estimates, not a fixed token-to-quota formula/i);
  assert.match(indexHtml, /amount of source information/i);
  assert.match(indexHtml, /loaded conversation and project context/i);
  assert.match(indexHtml, /<code>\/usage<\/code>/);
  assert.doesNotMatch(indexHtml, /class="knowledge-guide[^"']*reveal/);
  assert.doesNotMatch(indexHtml, /class="install-guide[^"']*reveal/);
  assert.doesNotMatch(indexHtml, /class="token-usage-legend[^"']*reveal/);
});

test('Development and QA stay available with prominent maintenance notices', () => {
  const indexHtml = readFileSync(join(root, 'doc-hub', 'index.html'), 'utf8');
  const expectedNotice = /Under maintenance\. These skills are being reviewed and may change\. Verify their output before using it in production\./;

  for (const [id, firstSkill] of [
    ['develop', 'twt-develop'],
    ['qa', 'twt-qa'],
  ]) {
    const group = indexHtml.match(
      new RegExp(`<section[^>]+data-maintenance-section="${id}"[\\s\\S]*?</section>`),
    )?.[0];
    assert.ok(group, `${id} must have a marked maintenance section on the overview`);
    assert.match(group, expectedNotice);
    assert.match(group, new RegExp(`href="skills/${firstSkill}\\.html"`));

    const blockHtml = readFileSync(join(root, 'doc-hub', 'blocks', `${id}.html`), 'utf8');
    assert.match(blockHtml, /class="status-ribbon maintenance"[^>]*>Maintenance</);
    assert.match(blockHtml, expectedNotice);
    assert.match(blockHtml, new RegExp(`href="../skills/${firstSkill}\\.html"`));
    assert.doesNotMatch(blockHtml, /Coming soon/);
  }
});

test('detail fact pills do not restyle nested token-meter elements', () => {
  const styles = readFileSync(join(root, 'doc-hub', 'assets', 'styles.css'), 'utf8');

  assert.match(styles, /\.fact-row > span\s*\{/);
  assert.doesNotMatch(styles, /\.fact-row span\s*\{/);
});

test('installation commands wrap within a phone-width code block', () => {
  const styles = readFileSync(join(root, 'doc-hub', 'assets', 'styles.css'), 'utf8');

  assert.match(
    styles,
    /\.install-steps pre code\s*\{[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere;/,
  );
});
