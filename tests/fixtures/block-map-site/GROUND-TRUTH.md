# block-map fixture — expected result

## Pages
index.html, services.html, pricing.html, app.html

## Expected canonical blocks
| Block | Tier | Aliases absorbed | Pages | Instances |
|---|---|---|---|---|
| Site header | organism | `.site-head` | 3 | 3 |
| Site footer | organism | `.site-foot` | 3 | 3 |
| Hero | organism | `.hero` | 1 | 1 |
| Card grid | organism | `.features`, `.svc`, `.related` | 3 | 3 |
| Card | molecule | `.card`, `.service-box`, `.teaser` | 3 | 9 |
| Pricing grid | organism | `.plans` | 1 | 1 |
| Plan | molecule | `.plan` | 1 | 3 |
| Testimonial grid | organism | `.quotes` | 1 | 1 |
| Quote | molecule | `.quote` | 1 | 3 |
| Heading group | molecule | `.hero__copy` | 1 | 1 |
| Logo row | molecule | `.logos` | 1 | 1 |

## Must-hold assertions
1. `.card`, `.service-box`, `.teaser` collapse into ONE block with 3 aliases and 9 instances.
2. `.container`, `.wrap`, `.elementor-section`, `.elementor-container`, `.elementor-column`,
   `.elementor-widget-wrap` are wrappers — they appear NOWHERE in the output.
3. `.plan` and `.quote` do NOT merge, despite identical tag skeletons
   (h3 + p + a), because content-semantics flags differ: has-price vs has-quote.
4. `.logos > li` (×6) are repeated ATOMS, not six molecules — each holds a single
   atom type. Repetition is recorded as arity on "Logo row".
5. app.html emits zero blocks under the static engine and raises a
   js-rendered warning. It must not emit a thin tree silently.

## Additional coverage pages (fix round 2)

Added after a review found the round-1 fix for rule (b)'s "no emitted
descendants" gate had over-reached into rule (a) (repetition), plus three
related issues the original 4 pages couldn't pin. The 4 pages above and
their table/assertions are unchanged — this section documents the 5 new
pages only.

### Pages

card-with-list.html, bem-card.html, landmark-free.html, page-wrap.html, data-table.html

### Expected canonical blocks

| Page | Block | Tier | Aliases absorbed | Instances |
|---|---|---|---|---|
| card-with-list.html | Package grid | organism | `.pkgs` | 1 |
| card-with-list.html | Package | molecule | `.pkg` (arity 3) | 3 |
| card-with-list.html | Feature list | molecule | `.feats` (semantic `<ul>`, nested under each `.pkg`) | 3 |
| bem-card.html | Card grid | organism | `.cards` | 1 |
| bem-card.html | Card | molecule | `.card` (arity 3) | 3 |
| bem-card.html | Card body | molecule | `.card__body` (arity 1, nested under each `.card`) | 3 |
| landmark-free.html | About content | organism | `main` (no class) | 1 |
| page-wrap.html | Site header | organism | `.site-head` | 1 |
| page-wrap.html | Hero | organism | `.hero` | 1 |
| page-wrap.html | Site footer | organism | `.site-foot` | 1 |
| data-table.html | Data table | organism | `table` (no class) | 1 |

### Must-hold assertions

6. `card-with-list.html`: `.pkg` is emitted 3× with arity 3 despite each `.pkg`
   wrapping a `<ul class="feats">` (an already-independently-qualifying
   semantic block) — repetition (rule a) does not require "no emitted
   descendants" the way leaf-cluster (rule b) does.
7. `bem-card.html`: `.card` (the outer, repeated node) is emitted with arity 3,
   not `.card__body` (the inner leaf) with arity 1 — the outer BEM block must
   not lose its identity to its own inner wrapper.
8. `landmark-free.html`: a page whose only content is `<main><h1>...<p>...
   </main>`, with no inner `<section>` and no other landmarks, still yields
   exactly 1 block. It must not be indistinguishable from a JS-rendered page
   (assertion 5) just because its content sits directly in `<main>`.
9. `page-wrap.html`: `section.page` (wrapping header + hero + footer) is
   NEVER emitted — header/hero/footer surface as their own organisms
   instead. `header > nav` still works despite this: header is still
   emitted as an organism, with nav nested inside it as a molecule, because
   header wraps exactly one landmark (nav) rather than 2+.
10. `data-table.html`: a 5-row `<table>` (link + image per row) is emitted
    as ONE block — not `table > tr ×5`. Row and cell tags never
    individually qualify; a link/image inside a cell still counts toward
    the table's own atom totals (`links: 5, images: 5`).
