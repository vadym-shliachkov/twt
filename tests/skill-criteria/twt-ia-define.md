# Criteria — twt-ia-define

Derived 2026-08-26 from frontmatter `writes:`, CONVENTIONS.md, and the skill's
Intent block. IDs are stable and never reused.

### C-001 · contract · sitemap-exists

- **dimension:** contract
- **source:** frontmatter `writes:`
- **self-declared:** no
- **fixture:** happy
- **assert:** `.twt-artifacts/pre-design/ia/sitemap.md` exists and is non-empty
- **evidence:** file path + line number

### C-002 · contract · functional-scope-exists

- **dimension:** contract
- **source:** frontmatter `writes:`
- **self-declared:** no
- **fixture:** happy
- **assert:** `.twt-artifacts/pre-design/ia/functional-scope.md` exists and is non-empty
- **evidence:** file path + line number

### C-003 · contract · decisions-parseable

- **dimension:** contract
- **source:** CONVENTIONS.md — decisions.md format
- **self-declared:** no
- **fixture:** happy
- **assert:** if `.twt-artifacts/pre-design/ia/decisions.md` exists, `node tools/check-decisions.mjs <path>` exits 0
- **evidence:** the command and its exit status

### C-004 · contract · no-writes-outside-contract

- **dimension:** contract
- **source:** frontmatter `writes:`
- **self-declared:** no
- **fixture:** happy
- **assert:** nothing was created under the target outside `.twt-artifacts/pre-design/ia/`
- **evidence:** a directory listing of the target

### C-005 · quality · every-page-has-a-purpose

- **dimension:** quality
- **source:** Intent → Success criteria
- **self-declared:** yes
- **fixture:** happy
- **assert:** every top-level page in sitemap.md carries a one-line statement of purpose
- **evidence:** file path + line numbers

## Fixtures

- **happy** — `node tools/eval-smoke.mjs seed <target> --scope ia` (positioning.md
  plus fetched homepage content)
