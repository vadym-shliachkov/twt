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
