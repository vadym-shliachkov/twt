# Criteria — twt-link-check

Derived by `/twt-skill-test` on 2026-09-01 from the skill's frontmatter
(`writes:`, `reads:`, `dependencies:`), `CONVENTIONS.md` / `tools/check-skill.ps1`
rules that apply to a `surface: command` QA skill, and the skill's own
Intent → Success criteria.

`dependencies.hard` is empty, so there are **no dispatch-dimension criteria** —
a run scoped to `dispatch` alone selects nothing and must be widened.

---

### C-001 · contract · declared-write-exists

- **dimension:** contract
- **source:** frontmatter `writes:`
- **self-declared:** no
- **fixture:** happy
- **assert:** a file matching `.twt-artifacts/link-check/*/link-report.md` exists
  under the target directory, is non-empty (> 500 bytes), and parses as Markdown
  with at least one `#`/`##` heading
- **evidence:** file path + byte size + first heading line

### C-002 · contract · target-slug-namespacing

- **dimension:** contract
- **source:** frontmatter `writes:` (`<target-slug>` path segment)
- **self-declared:** no
- **fixture:** happy
- **assert:** the report sits one directory *below* `.twt-artifacts/link-check/`
  in a slug directory recognisably derived from the probed target's host (e.g.
  contains `youthink`), not directly at `.twt-artifacts/link-check/link-report.md`
- **evidence:** the resolved directory path

### C-003 · contract · report-is-the-only-write

- **dimension:** contract
- **source:** Intent Non-goals ("read-only against the site; the only file it
  writes is its own report")
- **self-declared:** no
- **fixture:** happy
- **assert:** the target tree contains nothing outside
  `.twt-artifacts/link-check/` except the harness's own `.twt-skill-test-owned`
  marker — no scratch HTML, no cached pages, no crawl dump, no second artifact root
- **evidence:** a recursive listing of the target directory

### C-004 · contract · deterministic-tool-produced-the-report

- **dimension:** contract
- **source:** SKILL.md Step 2 ("Crawling, probing, status classification, and the
  whole report are deterministic — they live in the bundled tool. Never fetch
  pages yourself to hand-check links")
- **self-declared:** no
- **fixture:** happy
- **assert:** the report is machine-generated in shape, not hand-written prose —
  it carries per-finding structured rows/records with an HTTP status code, the
  target URL, and a `page:line` occurrence for each; and it reports a
  `pages_scanned`/`targets_checked`-style scan scale consistent with a real crawl
  (more than one page probed for a `site` run). A report of a handful of
  narrative paragraphs with no status codes fails this.
- **evidence:** quoted finding rows with line numbers from the report

### C-005 · contract · soft-input-absence-degrades-gracefully

- **dimension:** contract
- **source:** frontmatter `reads:` (`site/`, soft — `dependencies.hard: []`)
- **self-declared:** no
- **fixture:** happy
- **assert:** with no `site/` directory present in the target, the run still
  produced a complete report from the URL argument alone — no abort, and no
  placeholder/empty report explaining that a built site was missing
- **evidence:** absence of `site/` in the target listing + the report's own
  mode/target line showing a live URL run

### C-006 · quality · verdict-and-severity-counts-open-the-report

- **dimension:** quality
- **source:** Intent Success criteria, bullet 1
- **self-declared:** yes
- **fixture:** happy
- **assert:** the report opens with a **Verdict** of exactly one of `FAIL` /
  `REVISE` / `PASS`, accompanied by severity counts (BLOCKER / WARNING /
  SUGGESTION), and the verdict is consistent with those counts (FAIL iff
  blockers > 0; REVISE iff blockers = 0 and warnings > 0; PASS iff both 0)
- **evidence:** the verdict line + counts, quoted with line numbers

### C-007 · quality · every-finding-is-fully-located

- **dimension:** quality
- **source:** Intent Success criteria, bullet 2
- **self-declared:** yes
- **fixture:** happy
- **assert:** every finding in the report names all three of: the HTTP status (or
  the disk-miss reason), the target URL/path, and at least one occurrence giving
  the page **and** a line number **and** the element it was found on. Sample at
  least five findings (or all, if fewer); any finding missing one of the three fails.
- **evidence:** the sampled findings quoted with report line numbers

### C-008 · quality · one-finding-per-target-not-per-occurrence

- **dimension:** quality
- **source:** Intent Success criteria, bullet 3 ("A target linked from twenty
  pages is one finding with twenty sources, not twenty findings")
- **self-declared:** yes
- **fixture:** happy
- **assert:** no target URL appears as the subject of two separate findings of
  the same severity; a target seen on multiple pages is a single finding listing
  multiple sources. Verify by extracting every finding's target and checking for
  duplicates.
- **evidence:** the duplicate check — the extracted target list, or the specific
  repeated target if one exists

### C-009 · quality · bot-protection-downgraded-not-blocked

- **dimension:** quality
- **source:** SKILL.md Step 2 ("Downgrades known bot-protection … reported as
  *verify by hand*, not as broken … do not 'correct' it back to a blocker")
- **self-declared:** yes
- **fixture:** happy
- **assert:** no 401/403/429/999 response from a known bot-protected host
  (LinkedIn, Instagram, Facebook, X/Twitter, Cloudflare-fronted hosts, etc.) is
  classified BLOCKER; such targets appear as SUGGESTION / verify-by-hand, and the
  report says so. If the run produced no such responses, this is PASS by vacuity —
  state that explicitly in the evidence.
- **evidence:** the classification of each 401/403/429/999 finding, or an explicit
  statement that none occurred

### C-010 · quality · blocker-count-and-report-path-are-stated

- **dimension:** quality
- **source:** Intent Success criteria, bullet 4 ("The user is told the blocker
  count and the report path")
- **self-declared:** yes
- **fixture:** happy
- **assert:** the blocker count is stated as an explicit number in the report's
  own summary (not left to be counted by hand from the finding list), and the
  report identifies the target it describes so the summary is self-contained.
  *Note: the "told the user" half of this bullet lands in the runner's chat reply,
  which is outside the artifact tree — grade only the report-side half.*
- **evidence:** the quoted summary line with its line number

---

## Fixtures

- **happy** — no seeding required — clean target. The skill takes its target as
  an argument (`https://www.youthink.health`); it reads nothing from the project
  tree, and the absence of `site/` is itself what C-005 exercises.
