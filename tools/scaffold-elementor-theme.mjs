#!/usr/bin/env node
// scaffold-elementor-theme.mjs — deterministic file scaffold behind
// /twt-elementor-theme-creator. The child-theme boilerplate (9 files) and the
// conventions reference are fixed templates with five substitutions; having
// the model retype ~540 lines every run wastes tokens and invites drift.
//
//   node scaffold-elementor-theme.mjs --name "<ProjectName>" --slug <slug>
//                                     [--theme-path <path>] [--force]
//
// Never overwrites an existing file unless --force. Prints a JSON summary:
// { theme_path, slug, created: [], skipped: [], conventions_path }.
// Exit 0 on success; exit 2 on bad usage.
'use strict';
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const argv = process.argv.slice(2);
function flag(name, dflt) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const name = flag("--name");
const slug = flag("--slug");
const FORCE = argv.includes("--force");
if (!name || !slug) {
  console.error('Usage: scaffold-elementor-theme.mjs --name "<ProjectName>" --slug <slug> [--theme-path <path>] [--force]');
  process.exit(2);
}
if (!/^[a-z0-9-]+$/.test(slug)) { console.error(`invalid slug '${slug}' — lowercase alphanumeric + hyphens only`); process.exit(2); }

const S = slug;                                        // <slug>
const U = slug.toUpperCase().replace(/-/g, "_");       // <SLUG>
const T = slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("_"); // <SlugTitle>
const N = name;                                        // <ProjectName>
const themePath = flag("--theme-path", join("wp-content", "themes", `hello-elementor-${S}`));
const P = themePath.replace(/\\/g, "/").replace(/\/+$/, ""); // <THEME_PATH> (display form)

// ---- theme file templates -----------------------------------------------------

const files = {};

files["style.css"] = `/*
Theme Name:   Hello Elementor ${N}
Theme URI:
Description:  ${N} child theme for Hello Elementor
Author:
Author URI:
Template:     hello-elementor
Version:      0.1.0
Text Domain:  hello-elementor-${S}
*/
`;

files["functions.php"] = `<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( '${U}_CHILD_VERSION', '0.1.0' );

add_action( 'wp_enqueue_scripts', function () {
	$ver = ${U}_CHILD_VERSION;
	wp_enqueue_style( 'parent-style', get_template_directory_uri() . '/style.css' );
	wp_enqueue_style(
		'${S}-design-system',
		get_stylesheet_directory_uri() . '/assets/css/design-system.css',
		[ 'parent-style' ],
		$ver
	);
	wp_enqueue_style(
		'${S}-general',
		get_stylesheet_directory_uri() . '/assets/css/general.css',
		[ '${S}-design-system' ],
		$ver
	);
} );

add_action( 'elementor/init', function () {
	require_once get_stylesheet_directory() . '/inc/elementor/class-${S}-elementor.php';
	${T}_Elementor_Manager::instance();
} );
`;

files[`inc/elementor/class-${S}-elementor.php`] = `<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class ${T}_Elementor_Manager {

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		require_once get_stylesheet_directory() . '/inc/elementor/class-skeleton-widget-base.php';
		add_action( 'elementor/widgets/register', [ $this, 'register_widgets' ] );
		add_action( 'elementor/frontend/after_enqueue_styles', [ $this, 'enqueue_widget_styles' ] );
	}

	public function register_widgets( $widgets_manager ) {
		// Map 'widget-slug' => 'ClassName' for each widget.
		$map = [
			// 'hero' => 'Skeleton_Widget_Hero',
		];

		foreach ( $map as $slug => $class ) {
			$file = get_stylesheet_directory() . "/inc/elementor/widgets/class-${S}-{$slug}.php";
			if ( file_exists( $file ) ) {
				require_once $file;
				$widgets_manager->register( new $class() );
			}
		}
	}

	public function enqueue_widget_styles() {
		$ver = defined( '${U}_CHILD_VERSION' ) ? ${U}_CHILD_VERSION : '1.0';
		wp_enqueue_style(
			'${S}-widgets',
			get_stylesheet_directory_uri() . '/assets/css/widgets.css',
			[],
			$ver
		);
	}
}
`;

files["inc/elementor/class-skeleton-widget-base.php"] = `<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

abstract class Skeleton_Widget_Base extends \\Elementor\\Widget_Base {

	public function get_categories() {
		return [ '${S}' ];
	}

	/**
	 * Responsive padding control that writes CSS custom properties to {{WRAPPER}}.
	 * Call as the last line of register_controls() in every widget.
	 */
	protected function register_section_spacing() {
		$slug = '${S}';

		$this->start_controls_section(
			'section_spacing',
			[
				'label' => __( 'Section Spacing', 'hello-elementor-' . $slug ),
				'tab'   => \\Elementor\\Controls_Manager::TAB_ADVANCED,
			]
		);

		$this->add_responsive_control(
			'section_padding',
			[
				'label'      => __( 'Padding', 'hello-elementor-' . $slug ),
				'type'       => \\Elementor\\Controls_Manager::DIMENSIONS,
				'size_units' => [ 'px', '%', 'em', 'rem' ],
				'selectors'  => [
					'{{WRAPPER}}' => '--' . $slug . '-pad-top: {{TOP}}{{UNIT}}; --' . $slug . '-pad-right: {{RIGHT}}{{UNIT}}; --' . $slug . '-pad-bottom: {{BOTTOM}}{{UNIT}}; --' . $slug . '-pad-left: {{LEFT}}{{UNIT}};',
				],
			]
		);

		$this->end_controls_section();
	}

	/**
	 * Builds an href/target/rel attribute string from an Elementor URL control value.
	 * Returns '' when the URL is empty — callers use this to guard the surrounding <a>.
	 */
	protected function url_attrs( array $url_data ): string {
		$href = $url_data['url'] ?? '';
		if ( '' === $href ) {
			return '';
		}
		$attrs = 'href="' . esc_url( $href ) . '"';
		if ( ! empty( $url_data['is_external'] ) ) {
			$attrs .= ' target="_blank"';
		}
		if ( ! empty( $url_data['nofollow'] ) ) {
			$attrs .= ' rel="nofollow"';
		}
		return $attrs;
	}
}
`;

files["assets/css/design-system.css"] = `/**
 * Design System — ${N}
 * All CSS custom properties (design tokens) for this project.
 * Update values after design handoff. Never write hex literals in other files.
 */

:root {
	/* Colors */
	--${S}-navy:            #0D1B2A;
	--${S}-navy-dark:       #060D14;
	--${S}-teal:            #1DB89C;
	--${S}-teal-light:      #5ECFB8;

	/* Backgrounds */
	--${S}-bg-subtle:       #FAFAF8;
	--${S}-bg-muted:        #F2F2F0;
	--${S}-bg-navy:         var(--${S}-navy);

	/* Text */
	--${S}-text-primary:    #0D1B2A;
	--${S}-text-secondary:  #4A5568;
	--${S}-text-caption:    #718096;
	--${S}-text-body:       #2D3748;

	/* Typography */
	--${S}-font-display:    Georgia, serif;
	--${S}-font-body:       Inter, system-ui, sans-serif;

	/* Layout */
	--${S}-gutter:          64px;
	--${S}-max-width:       1280px;

	/* Motion */
	--${S}-hover-duration:  0.2s;
	--${S}-hover-ease:      ease;
	--${S}-ease-smooth:     cubic-bezier(0.4, 0, 0.2, 1);
}

@media (max-width: 960px) { :root { --${S}-gutter: 40px; } }
@media (max-width: 720px) { :root { --${S}-gutter: 24px; } }
@media (max-width: 480px) { :root { --${S}-gutter: 20px; } }
`;

files["assets/css/general.css"] = `/**
 * General — ${N}
 * Site-wide layout utilities, scoped to avoid leaking into editors or plugins.
 */

:where(.${S}-chrome, .${S}-homepage) .container {
	max-width:     var(--${S}-max-width);
	margin-left:   auto;
	margin-right:  auto;
	padding-left:  var(--${S}-gutter);
	padding-right: var(--${S}-gutter);
}
`;

files["wpml-config.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<wpml-config>
	<elementor-widgets>
		<!--
		Add a <widget> block for every widget that has translatable text.
		Mirror field names exactly as Elementor stores them.

		<widget id="${S}_hero">
			<key name="eyebrow"/>
			<key name="title"/>
			<key name="cta_label"/>
			<key name="items">
				<key name="title"/>
				<key name="excerpt"/>
			</key>
		</widget>
		-->
	</elementor-widgets>
</wpml-config>
`;

files["assets/js/.gitkeep"] = "";
files["inc/elementor/widgets/.gitkeep"] = "";

// ---- conventions reference ------------------------------------------------------

const conventions = `---
name: elementor-block-creator
description: Reference for the ${N} child theme conventions — widget skeleton, CSS scoping rules, cache-bust workflow, reveal system, design tokens. Load whenever working in ${P}/.
---

Project name: ${N}
Project slug: ${S}
Theme path: ${P}

## Scoping patterns

| Where | Selector | When to use |
|---|---|---|
| Default (homepage + chrome) | \`:where(.${S}-chrome, .${S}-homepage) .foo { }\` | Everything. Zero specificity, won't fight overrides. |
| Override Hello Elementor reset | \`.${S}-chrome .foo { }\` | Beat \`reset.css\` (single-class specificity). |
| Homepage body only | \`body.${S}-homepage .foo { }\` | Things that must NOT apply in nav/footer (page bg, hero margins). |
| Inner pages only | \`body:not(.${S}-homepage) .${S}-chrome .foo { }\` | Secondary pages. |

**Never write unscoped \`.foo { }\`.** It leaks onto Elementor / Gutenberg content on inner pages.
**Always declare all variables in design-system.css.**

## Widget rules (memorize)

**No demo defaults.** Controls ship empty; admin fills them in. \`register_controls()\` must NOT contain:
- \`'default' => 'Some demo text'\` on TEXT/TEXTAREA controls
- \`'default' => [ 'url' => 'https://...' ]\` on MEDIA controls
- \`'default' => [ [...] ]\` seed items on REPEATER controls

Only semantic-state defaults are allowed: switcher (\`'yes'\` / \`''\`), SELECT mode keys, NUMBER values needed by logic.

**Every render block guarded.** Read each setting into a trimmed local, wrap output in empty-checks, hide wrappers when all children are empty, and \`return;\` early when there's nothing to show.

## Widget naming rule

[${S}] – [Block Purpose] – [Variation]

## Widget skeleton (memorize)

\`\`\`php
<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class Skeleton_Widget_<Name> extends Skeleton_Widget_Base {
    public function get_name()  { return '${S}_<widget-slug>'; }
    public function get_title() { return __( '${N} <Title>', 'hello-elementor-${S}' ); }
    public function get_icon()  { return 'eicon-<icon>'; }

    protected function register_controls() {
        $this->start_controls_section( 'head', [ 'label' => __( 'Section head', 'hello-elementor-${S}' ) ] );
        $this->add_control( 'eyebrow', [
            'label' => __( 'Eyebrow', 'hello-elementor-${S}' ),
            'type'  => \\Elementor\\Controls_Manager::TEXT,
            // No 'default' — admin fills in.
        ] );
        $this->add_control( 'title', [
            'label' => __( 'Title', 'hello-elementor-${S}' ),
            'type'  => \\Elementor\\Controls_Manager::TEXT,
        ] );
        $this->end_controls_section();

        $this->register_section_spacing(); // always last
    }

    protected function render() {
        $s       = $this->get_settings_for_display();
        $eyebrow = isset( $s['eyebrow'] ) ? trim( (string) $s['eyebrow'] ) : '';
        $title   = isset( $s['title']   ) ? trim( (string) $s['title']   ) : '';

        if ( '' === $eyebrow && '' === $title ) {
            return;
        }
        ?>
        <section class="section" data-reveal-group>
            <div class="container">
                <?php if ( '' !== $eyebrow || '' !== $title ) : ?>
                <div class="section-head">
                    <?php if ( '' !== $eyebrow ) : ?>
                    <div class="eyebrow on-light" data-reveal>
                        <span class="eyebrow-line"></span><?php echo esc_html( $eyebrow ); ?>
                    </div>
                    <?php endif; ?>
                    <?php if ( '' !== $title ) : ?>
                    <h2 class="section-title" data-reveal><?php echo esc_html( $title ); ?></h2>
                    <?php endif; ?>
                </div>
                <?php endif; ?>
                <!-- widget body here, guarded per-element -->
            </div>
        </section>
        <?php
    }
}
\`\`\`

After creating the widget file, register it in \`inc/elementor/class-${S}-elementor.php\` inside \`$map\`.

## Empty-state patterns by control type

| Control type | Read | Guard |
|---|---|---|
| TEXT / TEXTAREA | \`$x = isset($s['x']) ? trim((string)$s['x']) : '';\` | \`if ( '' !== $x )\` |
| MEDIA (image / video URL) | \`$url = $s['x']['url'] ?? '';\` | \`if ( '' !== $url )\` |
| URL | \`$this->url_attrs( $s['x'] ?? [] )\` returns \`''\` for empty; guard the \`<a>\` on non-empty label | — |
| REPEATER | \`$items = !empty($s['x']) ? $s['x'] : [];\` | \`if ( ! empty( $items ) )\`; \`continue\` when all per-item fields empty |
| SWITCHER | \`$on = ( 'yes' === ($s['x'] ?? '') );\` | Combine with content checks |

## Section Spacing (required for every widget)

Last line of \`register_controls()\`:

\`\`\`php
$this->register_section_spacing();
\`\`\`

Widget root CSS must use **longhand** padding declarations (never the \`padding:\` shorthand):

\`\`\`css
:where(.${S}-chrome, .${S}-homepage) .my-widget {
    padding-top:    var(--${S}-pad-top,    64px);
    padding-right:  var(--${S}-pad-right,  0);
    padding-bottom: var(--${S}-pad-bottom, 64px);
    padding-left:   var(--${S}-pad-left,   0);
}
\`\`\`

Same longhand pattern inside every \`@media\` override. Shorthand \`padding: X Y\` resets all four sides and breaks per-side admin control.

## Cache-bust workflow (every CSS/JS edit)

\`\`\`bash
# 1. Lint PHP if edited
php -l inc/elementor/widgets/class-${S}-<widget-slug>.php

# 2. Bump version in functions.php
#    define( '${U}_CHILD_VERSION', '0.X.Y' );  →  0.X.Z

# 3. Bump version in style.css header

# 4. Flush caches
wp cache flush
wp elementor flush_css
\`\`\`

Watch brace balance in CSS — an unclosed \`{\` silently breaks every rule below it.

## Reveal system

- \`data-reveal-group\` on the section wrapper — parent observer
- \`data-reveal\` on each child element that should animate in
- \`data-reveal-stagger\` on a container — cascades \`data-reveal\` to direct children with delays
- Editor mode (Elementor / Gutenberg) is auto-detected; content force-reveals immediately

## Design system tokens

\`\`\`
--${S}-navy, --${S}-navy-dark           dark blues
--${S}-teal, --${S}-teal-light          accent greens
--${S}-bg-subtle                          page background ("white" surface)
--${S}-bg-muted                           hover background
--${S}-bg-navy                            dark sections
--${S}-text-primary / -secondary / -caption / -body
--${S}-font-display                       Georgia italic
--${S}-font-body                          Inter
--${S}-gutter                             64 → 20 across breakpoints
--${S}-max-width: 1280px
--${S}-hover-duration / --${S}-hover-ease
--${S}-ease-smooth                        reveal/scroll easing
\`\`\`

Update all values in \`assets/css/design-system.css\` after design handoff.

## Responsive tiers

| Range | Use |
|---|---|
| > 960px | Desktop layout |
| ≤ 960px | Tablet (2-col grids, smaller hero) |
| ≤ 720px | Mobile (stacked, simplified) |
| ≤ 600px | Narrow (hero CTAs stack) |
| ≤ 480px | Small mobile (forms stack full-width) |

## Common WPML config block

\`\`\`xml
<widget id="${S}_<widget-slug>">
    <key name="eyebrow"/>
    <key name="title"/>
    <key name="cta_label"/>
    <key name="items">
        <key name="title"/>
        <key name="excerpt"/>
    </key>
</widget>
\`\`\`

Mirror an existing widget block in \`wpml-config.xml\` for exact field-name conventions.
`;

// ---- write -----------------------------------------------------------------------

const created = [], skipped = [];
function put(path, content) {
  if (existsSync(path) && !FORCE) { skipped.push(path); return; }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  created.push(path);
}

for (const [rel, content] of Object.entries(files)) put(join(themePath, rel), content);
const conventionsPath = join(".twt-artifacts", "elementor-theme", "conventions.md");
put(conventionsPath, conventions);

console.log(JSON.stringify({
  theme_path: themePath, slug: S,
  created, skipped,
  conventions_path: conventionsPath,
}, null, 2));
