---
name: twt-elementor-theme-creator
category: elementor
description: Scaffold a production-ready Hello Elementor child theme for a WordPress project
version: 1.1.1
accepts_arguments: false
inputs:
  - project name
  - short slug (auto-derived, user confirms)
dependencies:
  hard: []
  soft: []
reads: []
writes:
  - wp-content/themes/hello-elementor-<slug>/style.css
  - wp-content/themes/hello-elementor-<slug>/functions.php
  - wp-content/themes/hello-elementor-<slug>/assets/css/design-system.css
  - wp-content/themes/hello-elementor-<slug>/assets/css/general.css
  - wp-content/themes/hello-elementor-<slug>/inc/elementor/class-<slug>-elementor.php
  - wp-content/themes/hello-elementor-<slug>/inc/elementor/class-skeleton-widget-base.php
  - wp-content/themes/hello-elementor-<slug>/inc/elementor/widgets/.gitkeep
  - wp-content/themes/hello-elementor-<slug>/assets/js/.gitkeep
  - wp-content/themes/hello-elementor-<slug>/wpml-config.xml
  - .twt-artifacts/elementor-theme/conventions.md
---

# /twt-elementor-theme-creator

## Intent

**Purpose:** Scaffold a Hello Elementor child theme and write the canonical project conventions file (`conventions.md`) that downstream `/twt-elementor-*` skills depend on. Run once per WordPress project.

**Non-goals:**
- Doesn't build widgets (that's `/twt-elementor-block-creator`)
- Doesn't install Hello Elementor parent theme — assumes it exists
- Doesn't overwrite existing theme files without confirmation

**Success criteria:**
- Theme folder exists at `wp-content/themes/hello-elementor-<slug>/` with all required files
- `.twt-artifacts/elementor-theme/conventions.md` exists and is readable by other skills
- `design-system.css` contains the CSS custom-property scaffold
- Theme is activatable in WordPress without errors

---

## Overview

This skill creates:
- A Hello Elementor child theme at `wp-content/themes/hello-elementor-<slug>/`
- Elementor widget loader with a reusable `Skeleton_Widget_Base` class
- CSS design system (tokens + scoped general styles)
- A conventions reference (`.twt-artifacts/elementor-theme/conventions.md`) that future `/twt-elementor-*` skills load automatically

**It asks three questions, then creates everything automatically.**

---

## Step 1 — Introduction

Print this before doing anything else:

```
╔══════════════════════════════════════════════════════════╗
║  TWT — Elementor Theme Creator                          ║
╠══════════════════════════════════════════════════════════╣
║  Creates a production-ready Hello Elementor child       ║
║  theme with:                                            ║
║    • style.css + functions.php                          ║
║    • Elementor widget loader (class-<slug>-elementor)   ║
║    • Skeleton widget base class                         ║
║    • CSS design system (tokens + scoped styles)         ║
║    • WPML config skeleton                               ║
║    • Project conventions reference for future skills    ║
║                                                         ║
║  This setup becomes the base for all future             ║
║  /twt-elementor-block-creator runs.                     ║
╚══════════════════════════════════════════════════════════╝
```

---

## Step 2 — Project Setup

**Check first:** Does `.twt-artifacts/elementor-theme/conventions.md` exist?

- **Yes →** Read it and extract `Project name:` and `Project slug:` values. Skip to Step 3.
- **No →** Continue below.

Ask the user:

> **What is the project name?**
> *(Example: Project Industries, Acme Financial Group)*

Wait for the response. Then generate a short project slug:

**Slug rules:**
- Lowercase, alphanumeric + hyphens only
- 2–5 characters preferred
- Use initials for multi-word names

| Name | Slug |
|------|------|
| Project Industries | `pi` |
| Acme Financial Group | `afg` |
| Blue Horizon Digital | `bhd` |
| Momentum Health | `mh` |

Display:

```
Project slug: `<slug>`

This slug is used everywhere:
  • Theme folder:       hello-elementor-<slug>/
  • CSS scope classes:  .<slug>-chrome, .<slug>-homepage
  • Widget IDs:         <slug>_hero, <slug>_cards, …
  • Translation domain: hello-elementor-<slug>
  • Cache constant:     <SLUG>_CHILD_VERSION
```

Ask via the **AskUserQuestion** tool (single-select, header "Slug OK?") Is this slug correct?:
- **Looks good** — use this slug as-is
- **Enter a different slug** — I'll provide a different slug
- **You decide** — use the proposed slug as-is

Record the choice and continue. If the user chose "Enter a different slug", ask for their preferred slug as free-form text.

**Derived values (compute once, use everywhere):**
- `<SLUG>` = slug uppercased (e.g. `pi` → `PI`)
- `<SlugTitle>` = slug title-cased (e.g. `pi` → `Pi`)

---

## Step 3 — Theme Path

Ask via the **AskUserQuestion** tool (single-select, header "Theme folder") Does the theme folder already exist?:
- **Yes — provide the existing path** — the folder already exists; I'll give you the path
- **No — create it** — create it at `wp-content/themes/hello-elementor-<slug>/`
- **You decide** — I detect whether the folder exists and proceed accordingly (create if absent, never overwrite existing files)

Record the choice and continue. If the user chose "Yes — provide the existing path", ask for the path as free-form text, then use it as `THEME_PATH`. Create any missing files inside but don't overwrite existing ones. If "No — create it", set `THEME_PATH = wp-content/themes/hello-elementor-<slug>/`.

---

## Step 4 — Create Theme Files

Create all files below. Substitute throughout:

| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `<slug>` | project slug | `pi` |
| `<ProjectName>` | project name | `Project Industries` |
| `<SLUG>` | slug uppercased | `PI` |
| `<SlugTitle>` | slug title-cased | `Pi` |
| `<THEME_PATH>` | theme folder path | `wp-content/themes/hello-elementor-pi` |

---

### `<THEME_PATH>/style.css`

```css
/*
Theme Name:   Hello Elementor <ProjectName>
Theme URI:
Description:  <ProjectName> child theme for Hello Elementor
Author:
Author URI:
Template:     hello-elementor
Version:      0.1.0
Text Domain:  hello-elementor-<slug>
*/
```

---

### `<THEME_PATH>/functions.php`

```php
<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( '<SLUG>_CHILD_VERSION', '0.1.0' );

add_action( 'wp_enqueue_scripts', function () {
	$ver = <SLUG>_CHILD_VERSION;
	wp_enqueue_style( 'parent-style', get_template_directory_uri() . '/style.css' );
	wp_enqueue_style(
		'<slug>-design-system',
		get_stylesheet_directory_uri() . '/assets/css/design-system.css',
		[ 'parent-style' ],
		$ver
	);
	wp_enqueue_style(
		'<slug>-general',
		get_stylesheet_directory_uri() . '/assets/css/general.css',
		[ '<slug>-design-system' ],
		$ver
	);
} );

add_action( 'elementor/init', function () {
	require_once get_stylesheet_directory() . '/inc/elementor/class-<slug>-elementor.php';
	<SlugTitle>_Elementor_Manager::instance();
} );
```

---

### `<THEME_PATH>/inc/elementor/class-<slug>-elementor.php`

```php
<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class <SlugTitle>_Elementor_Manager {

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
			$file = get_stylesheet_directory() . "/inc/elementor/widgets/class-<slug>-{$slug}.php";
			if ( file_exists( $file ) ) {
				require_once $file;
				$widgets_manager->register( new $class() );
			}
		}
	}

	public function enqueue_widget_styles() {
		$ver = defined( '<SLUG>_CHILD_VERSION' ) ? <SLUG>_CHILD_VERSION : '1.0';
		wp_enqueue_style(
			'<slug>-widgets',
			get_stylesheet_directory_uri() . '/assets/css/widgets.css',
			[],
			$ver
		);
	}
}
```

---

### `<THEME_PATH>/inc/elementor/class-skeleton-widget-base.php`

```php
<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

abstract class Skeleton_Widget_Base extends \Elementor\Widget_Base {

	public function get_categories() {
		return [ '<slug>' ];
	}

	/**
	 * Responsive padding control that writes CSS custom properties to {{WRAPPER}}.
	 * Call as the last line of register_controls() in every widget.
	 */
	protected function register_section_spacing() {
		$slug = '<slug>';

		$this->start_controls_section(
			'section_spacing',
			[
				'label' => __( 'Section Spacing', 'hello-elementor-' . $slug ),
				'tab'   => \Elementor\Controls_Manager::TAB_ADVANCED,
			]
		);

		$this->add_responsive_control(
			'section_padding',
			[
				'label'      => __( 'Padding', 'hello-elementor-' . $slug ),
				'type'       => \Elementor\Controls_Manager::DIMENSIONS,
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
```

---

### `<THEME_PATH>/assets/css/design-system.css`

```css
/**
 * Design System — <ProjectName>
 * All CSS custom properties (design tokens) for this project.
 * Update values after design handoff. Never write hex literals in other files.
 */

:root {
	/* Colors */
	--<slug>-navy:            #0D1B2A;
	--<slug>-navy-dark:       #060D14;
	--<slug>-teal:            #1DB89C;
	--<slug>-teal-light:      #5ECFB8;

	/* Backgrounds */
	--<slug>-bg-subtle:       #FAFAF8;
	--<slug>-bg-muted:        #F2F2F0;
	--<slug>-bg-navy:         var(--<slug>-navy);

	/* Text */
	--<slug>-text-primary:    #0D1B2A;
	--<slug>-text-secondary:  #4A5568;
	--<slug>-text-caption:    #718096;
	--<slug>-text-body:       #2D3748;

	/* Typography */
	--<slug>-font-display:    Georgia, serif;
	--<slug>-font-body:       Inter, system-ui, sans-serif;

	/* Layout */
	--<slug>-gutter:          64px;
	--<slug>-max-width:       1280px;

	/* Motion */
	--<slug>-hover-duration:  0.2s;
	--<slug>-hover-ease:      ease;
	--<slug>-ease-smooth:     cubic-bezier(0.4, 0, 0.2, 1);
}

@media (max-width: 960px) { :root { --<slug>-gutter: 40px; } }
@media (max-width: 720px) { :root { --<slug>-gutter: 24px; } }
@media (max-width: 480px) { :root { --<slug>-gutter: 20px; } }
```

---

### `<THEME_PATH>/assets/css/general.css`

```css
/**
 * General — <ProjectName>
 * Site-wide layout utilities, scoped to avoid leaking into editors or plugins.
 */

:where(.<slug>-chrome, .<slug>-homepage) .container {
	max-width:     var(--<slug>-max-width);
	margin-left:   auto;
	margin-right:  auto;
	padding-left:  var(--<slug>-gutter);
	padding-right: var(--<slug>-gutter);
}
```

---

### `<THEME_PATH>/wpml-config.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<wpml-config>
	<elementor-widgets>
		<!--
		Add a <widget> block for every widget that has translatable text.
		Mirror field names exactly as Elementor stores them.

		<widget id="<slug>_hero">
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
```

---

### Empty directories

Create a `.gitkeep` placeholder inside each:
- `<THEME_PATH>/assets/js/.gitkeep`
- `<THEME_PATH>/inc/elementor/widgets/.gitkeep`

Do **not** create `screenshot.png` — WordPress shows a placeholder automatically.

---

## Step 5 — Create Conventions File

Create `.twt-artifacts/elementor-theme/conventions.md`.
Substitute all `<slug>`, `<ProjectName>`, `<SLUG>`, and `<THEME_PATH>` placeholders throughout.

The file must contain exactly this structure (with substitutions applied):

~~~markdown
---
name: elementor-block-creator
description: Reference for the <ProjectName> child theme conventions — widget skeleton, CSS scoping rules, cache-bust workflow, reveal system, design tokens. Load whenever working in <THEME_PATH>/.
---

Project name: <ProjectName>
Project slug: <slug>
Theme path: <THEME_PATH>

## Scoping patterns

| Where | Selector | When to use |
|---|---|---|
| Default (homepage + chrome) | `:where(.<slug>-chrome, .<slug>-homepage) .foo { }` | Everything. Zero specificity, won't fight overrides. |
| Override Hello Elementor reset | `.<slug>-chrome .foo { }` | Beat `reset.css` (single-class specificity). |
| Homepage body only | `body.<slug>-homepage .foo { }` | Things that must NOT apply in nav/footer (page bg, hero margins). |
| Inner pages only | `body:not(.<slug>-homepage) .<slug>-chrome .foo { }` | Secondary pages. |

**Never write unscoped `.foo { }`.** It leaks onto Elementor / Gutenberg content on inner pages.
**Always declare all variables in design-system.css.**

## Widget rules (memorize)

**No demo defaults.** Controls ship empty; admin fills them in. `register_controls()` must NOT contain:
- `'default' => 'Some demo text'` on TEXT/TEXTAREA controls
- `'default' => [ 'url' => 'https://...' ]` on MEDIA controls
- `'default' => [ [...] ]` seed items on REPEATER controls

Only semantic-state defaults are allowed: switcher (`'yes'` / `''`), SELECT mode keys, NUMBER values needed by logic.

**Every render block guarded.** Read each setting into a trimmed local, wrap output in empty-checks, hide wrappers when all children are empty, and `return;` early when there's nothing to show.

## Widget naming rule

[<slug>] – [Block Purpose] – [Variation]

## Widget skeleton (memorize)

```php
<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class Skeleton_Widget_<Name> extends Skeleton_Widget_Base {
    public function get_name()  { return '<slug>_<widget-slug>'; }
    public function get_title() { return __( '<ProjectName> <Title>', 'hello-elementor-<slug>' ); }
    public function get_icon()  { return 'eicon-<icon>'; }

    protected function register_controls() {
        $this->start_controls_section( 'head', [ 'label' => __( 'Section head', 'hello-elementor-<slug>' ) ] );
        $this->add_control( 'eyebrow', [
            'label' => __( 'Eyebrow', 'hello-elementor-<slug>' ),
            'type'  => \Elementor\Controls_Manager::TEXT,
            // No 'default' — admin fills in.
        ] );
        $this->add_control( 'title', [
            'label' => __( 'Title', 'hello-elementor-<slug>' ),
            'type'  => \Elementor\Controls_Manager::TEXT,
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
```

After creating the widget file, register it in `inc/elementor/class-<slug>-elementor.php` inside `$map`.

## Empty-state patterns by control type

| Control type | Read | Guard |
|---|---|---|
| TEXT / TEXTAREA | `$x = isset($s['x']) ? trim((string)$s['x']) : '';` | `if ( '' !== $x )` |
| MEDIA (image / video URL) | `$url = $s['x']['url'] ?? '';` | `if ( '' !== $url )` |
| URL | `$this->url_attrs( $s['x'] ?? [] )` returns `''` for empty; guard the `<a>` on non-empty label | — |
| REPEATER | `$items = !empty($s['x']) ? $s['x'] : [];` | `if ( ! empty( $items ) )`; `continue` when all per-item fields empty |
| SWITCHER | `$on = ( 'yes' === ($s['x'] ?? '') );` | Combine with content checks |

## Section Spacing (required for every widget)

Last line of `register_controls()`:

```php
$this->register_section_spacing();
```

Widget root CSS must use **longhand** padding declarations (never the `padding:` shorthand):

```css
:where(.<slug>-chrome, .<slug>-homepage) .my-widget {
    padding-top:    var(--<slug>-pad-top,    64px);
    padding-right:  var(--<slug>-pad-right,  0);
    padding-bottom: var(--<slug>-pad-bottom, 64px);
    padding-left:   var(--<slug>-pad-left,   0);
}
```

Same longhand pattern inside every `@media` override. Shorthand `padding: X Y` resets all four sides and breaks per-side admin control.

## Cache-bust workflow (every CSS/JS edit)

```bash
# 1. Lint PHP if edited
php -l inc/elementor/widgets/class-<slug>-<widget-slug>.php

# 2. Bump version in functions.php
#    define( '<SLUG>_CHILD_VERSION', '0.X.Y' );  →  0.X.Z

# 3. Bump version in style.css header

# 4. Flush caches
wp cache flush
wp elementor flush_css
```

Watch brace balance in CSS — an unclosed `{` silently breaks every rule below it.

## Reveal system

- `data-reveal-group` on the section wrapper — parent observer
- `data-reveal` on each child element that should animate in
- `data-reveal-stagger` on a container — cascades `data-reveal` to direct children with delays
- Editor mode (Elementor / Gutenberg) is auto-detected; content force-reveals immediately

## Design system tokens

```
--<slug>-navy, --<slug>-navy-dark           dark blues
--<slug>-teal, --<slug>-teal-light          accent greens
--<slug>-bg-subtle                          page background ("white" surface)
--<slug>-bg-muted                           hover background
--<slug>-bg-navy                            dark sections
--<slug>-text-primary / -secondary / -caption / -body
--<slug>-font-display                       Georgia italic
--<slug>-font-body                          Inter
--<slug>-gutter                             64 → 20 across breakpoints
--<slug>-max-width: 1280px
--<slug>-hover-duration / --<slug>-hover-ease
--<slug>-ease-smooth                        reveal/scroll easing
```

Update all values in `assets/css/design-system.css` after design handoff.

## Responsive tiers

| Range | Use |
|---|---|
| > 960px | Desktop layout |
| ≤ 960px | Tablet (2-col grids, smaller hero) |
| ≤ 720px | Mobile (stacked, simplified) |
| ≤ 600px | Narrow (hero CTAs stack) |
| ≤ 480px | Small mobile (forms stack full-width) |

## Common WPML config block

```xml
<widget id="<slug>_<widget-slug>">
    <key name="eyebrow"/>
    <key name="title"/>
    <key name="cta_label"/>
    <key name="items">
        <key name="title"/>
        <key name="excerpt"/>
    </key>
</widget>
```

Mirror an existing widget block in `wpml-config.xml` for exact field-name conventions.
~~~

---

## Step 6 — Final Checks

Run PHP syntax checks on all created PHP files:

```bash
php -l <THEME_PATH>/functions.php
php -l <THEME_PATH>/inc/elementor/class-<slug>-elementor.php
php -l <THEME_PATH>/inc/elementor/class-skeleton-widget-base.php
```

Fix any errors before reporting done.

---

## Step 7 — Completion

Print the status table with actual resolved values:

```
╔══════════════════════════════════════════════════════════╗
║  ✓ Theme setup complete                                 ║
╠════════════════════════════════╦═════════════════════════╣
║  Item                          ║  Status                 ║
╠════════════════════════════════╬═════════════════════════╣
║  Theme folder                  ║  ✓ Created / Existing   ║
║  style.css + functions.php     ║  ✓ Created              ║
║  Elementor integration         ║  ✓ Created              ║
║  Widget base class             ║  ✓ Created              ║
║  Design system CSS             ║  ✓ Created              ║
║  General CSS                   ║  ✓ Created              ║
║  WPML config                   ║  ✓ Created              ║
║  Conventions reference         ║  ✓ Created              ║
╚════════════════════════════════╩═════════════════════════╝

Theme: <THEME_PATH>
Slug:  <slug>
```

Then print:

```
To activate the theme in WordPress:

  Appearance → Themes → "Hello Elementor <ProjectName>" → Activate

Via WP-CLI:
  wp theme activate hello-elementor-<slug>

Next steps:
  • Update token values in assets/css/design-system.css after design handoff
  • Use /twt-elementor-block-creator to scaffold widgets
```
