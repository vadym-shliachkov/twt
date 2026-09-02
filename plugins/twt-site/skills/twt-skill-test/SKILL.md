---
name: twt-skill-test
surface: command
category: meta
family: meta
role: tool
unit: twt-site
description: (v1.0.4) Agentic skill harness — derive frozen criteria, run a skill from the working tree, grade blind, optionally fix, re-run bounded (marketplace-dev only)
version: 1.0.4
accepts_arguments: true
inputs:
  - Skill name (required), plus optional --target, --args, --fix, --scope, --iterations, --fixture
dependencies:
  hard: []
  soft: []
reads:
  - skills/twt-<name>/SKILL.md
  - tests/skill-criteria/twt-<name>.md
  - CONVENTIONS.md
writes:
  - tests/skill-criteria/twt-<name>.md
  - tests/skill-test-runs/<skill>-<stamp>/report.md
---

# /twt-skill-test

## Intent

**Purpose:** The generic, agentic counterpart to `/twt-eval-smoke`. Point it at any
`twt-*` skill and it derives a frozen rubric, runs the skill's working-tree bytes
against a disposable target, grades the result with a blind subagent, optionally
fixes what failed inside the skill's own directory, and re-runs — bounded at 3
iterations. This closes the gap the other two structural layers leave open:
`tools/check-skill.ps1` never runs a skill, and `/twt-eval-smoke` only covers five
hand-fixtured scopes. `/twt-skill-test` covers the other ~90.

**Non-goals:**
- **Never pushes, and no flag could make it push.** A `--fix` run ends in one local
  commit on `main` and stops. There is no `--push` flag and no path to add one.
- **Not a replacement for `tools/check-skill.ps1`.** That linter is structural
  (frontmatter, gate presence, call shape) and runs in milliseconds with zero
  model cost. This harness is behavioral and expensive — reach for the linter
  first, always.
- **Not a design-taste bar.** Quality-dimension criteria are drawn from the
  tested skill's own Intent block and tagged `self-declared: yes`; a pass built
  only from those is reported as `converged-pass-weak`, not a clean pass. This
  harness has teeth on contract and dispatch, not on taste.
- Not a fixture-content generator for `/twt-eval-smoke` — it only *proposes* a
  mechanically-checkable assertion in the report; promoting it is a separate,
  manual act.

**Success criteria:**
- Every run ends with `tests/skill-test-runs/<skill>-<stamp>/report.md` stating a
  plain-language stop reason, a per-iteration verdict table, the fidelity header,
  and (on `--fix`) either a commit SHA or a stated reason nothing landed.
- A `--fix` run never edits anything outside `skills/twt-<name>/`, never touches
  `version:`, and never edits `tests/skill-criteria/` after Step 2 froze it
  (Step 2 may *create* a missing rubric; nothing after it may change one).
- A fix the run never re-graded is reported as `UNVERIFIED`, never folded in
  with the fixes a later iteration actually evidenced.
- A misbehaving runner (one that keeps reaching for the Skill tool despite the
  explicit prohibition) halts the run within 3 consecutive occurrences instead of
  looping unbounded.

---

## Step 1 — Guards

1. Glob for `tools/skill-test.mjs` at the project root. If it is absent, stop:
   "This is a marketplace-dev harness — run `/twt-skill-test` inside the twt repo."
2. Parse `$ARGUMENTS`. The first token is the **skill name** (e.g. `twt-ia-define`,
   `twt-qa-links`) — required. If missing, ask for it as a plain free-form prompt
   (this is an identifier, not a fixed-option choice). Remaining flags, all
   optional:
   - `--target <dir>` — default `C:\Work\twt\skill-test\<skill>-<NN>`, where `<NN>`
     is a fresh zero-padded counter (Glob the parent dir, take one past the
     highest existing `<skill>-NN`). External and disposable by design — a
     dispatched skill honours a relocated project root (confirmed empirically
     2026-08-26 against `twt-ia-define`: all declared artifacts landed under the
     relocated root and this repo's tree stayed clean).
   - `--args "..."` — passed verbatim to the tested skill's own arguments. Many
     twt skills take their own `--`-leading flags (e.g. `--live`), so this
     value can itself start with `--`; every internal `skill-test.mjs` call
     that carries it forward (Step 3.3) must use `--args="<value>"` (the
     `=` form), never a space-separated `--args "<value>"` — the tool's `flag()`
     helper cannot otherwise tell "the value happens to start with `--`" apart
     from "the next flag's name," and defaults rather than guessing.
   - `--fix` — default OFF. Without it this is a report-only run: nothing under
     `skills/` is touched.
   - `--scope contract,dispatch,quality,robustness` — default
     `contract,dispatch,quality`. This is a **dimension filter, and it is
     load-bearing**: Step 2's `--freeze` narrows the run's `criteriaIds` to
     criteria whose `dimension:` is in the list, and that narrowed list is
     the only thing `converged()` derives a pass from. A criterion in the
     file but out of scope is never graded and reads `n/a` in the report —
     so a scope that selects nothing is a hard error at freeze time (exit 1),
     not a vacuous pass. `robustness` is opt-in because each extra fixture is
     a full additional run per iteration.
   - `--iterations N` — **Hard-capped at 3 regardless of what is passed** —
     this harness never runs a fourth iteration, full stop. Compute
     `effectiveCap` now, in this order:
     - `--iterations N` given → `effectiveCap = min(N, 3)`.
     - Not given, **and `--fix` was given** → `effectiveCap = 3`.
     - Not given, and **`--fix` was not given** → `effectiveCap = 1`.
       Without `--fix` nothing edits the skill between iterations, so
       iteration 2 re-runs identical bytes against an identical fixture and
       can only reproduce iteration 1's verdicts — at the cost of a second
       full skill run plus a second grader dispatch. It would then stop as
       `no-progress`, which reads as "the loop was thrashing" and misnames
       what happened. A report is one iteration. Pass `--iterations 2` (or 3)
       explicitly if you actually want to sample run-to-run variance.

     Carry `effectiveCap` forward: it is Step 3's own loop bound (not the
     literal number 3) and the `--cap` value passed to every `converged` call
     in this run — `--iterations 1` must actually run one iteration, not three.
   - `--fixture <name>` — repeatable; `robustness` scope only.
3. Confirm `skills/<skill>/SKILL.md` exists (Glob). If not, stop and name the
   closest match found under `skills/`.
4. Run (Bash): `node "${CLAUDE_PROJECT_DIR}/tools/skill-test.mjs" guard "${CLAUDE_PROJECT_DIR}"`.
   Record its `mayCommit` field — this gates Step 5 (Land) only; a dirty tree still
   runs and reports normally, per the tool's own contract.
5. Record the plugin-cache state for the report's fidelity header: list
   `~/.claude/plugins/cache/twt-marketplace/twt/` (Bash:
   `ls "$HOME/.claude/plugins/cache/twt-marketplace/twt/"`) and take the
   highest version-sorted entry as `pluginCacheVersion`. If the path does not
   exist, use `unknown`. Any sub-skill the tested skill dispatches resolves to
   *that* cached copy, never the working tree — the report must be able to name
   it (this is the mixed-version fact the fidelity header exists to surface).
6. **Cost-class warning.** If `<skill>` is one of `twt-site`, `twt-site-dev`,
   `twt-design`, `twt-pre-design`, `twt-develop`, `twt-qa`, ask via
   **AskUserQuestion** (single-select, header "Orchestrator run"): "Proceed"
   (`effectiveCap` iterations of a full pipeline — name the number you actually
   computed — and any sub-skill it dispatches is mixed-version under
   injection) / "Reduce to 1 iteration" / "Cancel" / **You
   decide** (default Proceed — resolves only this question). Apply the answer
   before Step 2 — "Reduce to 1 iteration" sets `effectiveCap = 1` regardless
   of whatever `--iterations` value (or default) Step 1.2 computed; this is
   the cost control that only works if `effectiveCap` actually gates Step 3's
   loop and its `converged --cap` calls, not just the number 3 in prose.

## Step 2 — Criteria

Resolve the criteria file at `tests/skill-criteria/<skill>.md` (Read/Glob). Keep
its `## Fixtures` section in context for the rest of the run — Step 3.2 reads it
every iteration to find the command that actually materializes the active
fixture.

**If it exists:** use it as-is. Never edit it in this step or any later step —
extending the rubric is a separate, deliberate action outside this command; if
the run turns up a gap in it, say so in the final report instead of writing to it.

**If it does not exist:** derive it from the four anchors below, tagging every
criterion drawn from anchor 4 `self-declared: yes` (everything else
`self-declared: no`), then write it with the Write tool.

1. **Frontmatter `writes:`** (contract) — one criterion per declared path: it
   exists, is non-empty, and parses in its declared format (a `.md` has the
   headings its own convention implies; a `.css`/`.json` parses as such).
2. **Frontmatter `reads:`** (contract) — for each declared hard input, a
   criterion that its absence produces a loud abort rather than silent
   degradation; for each soft input, that its absence degrades gracefully.
3. **CONVENTIONS.md + `tools/check-skill.ps1`** (contract) — include only the
   rules that actually apply to this skill's `surface:`/name pattern: a setup
   gate present when the name is one of the six pipeline entry points; every
   fixed-option prompt uses AskUserQuestion rather than a numbered menu; a
   `*-validate` name writes nothing but its sibling `validation-report.md`; a
   `*-define` name detects an existing artifact and enters refinement mode
   instead of overwriting it.
4. **`dependencies.hard` vs. the run's dispatch trace** (dispatch) — one
   criterion per hard dependency: the run actually invoked that sub-skill
   (via the Agent tool) rather than inlining its logic. Skip this anchor
   entirely when `dependencies.hard` is empty.
5. **The skill's own Intent → Success criteria** (quality, `self-declared: yes`)
   — one criterion per bullet, verbatim in spirit.

Use this exact per-criterion format (IDs are stable and never reused — start at
`C-001` and increment):

```markdown
### C-003 · contract · declared-write-exists

- **dimension:** contract
- **source:** frontmatter `writes:`
- **self-declared:** no
- **fixture:** happy
- **assert:** `.twt-artifacts/pre-design/ia/sitemap.md` exists, is non-empty, and
  contains at least one `##` heading per top-level page
- **evidence:** file path + line number, or command output
```

End the file with a `## Fixtures` section naming which fixtures this skill's
criteria use. `happy` (clean target, first run) is the only one required; name
`missing-input` (target seeded with a hard dependency's artifact absent),
`refine` (a happy pass already ran, exercising refinement-mode idempotency), or
`degraded-soft-dep` (a soft dependency's artifact absent) only if `--scope`
includes `robustness` and criteria reference them.

**Every bullet in `## Fixtures` must resolve one of two ways — Step 3.2 halts
the run on anything left ambiguous, so don't write an ambiguous one:**
- **Seeded** — name the exact runnable command that materializes it (e.g.
  `node tools/eval-smoke.mjs seed <target> --scope ia`). You do not also need
  to spell out a path to check afterward: every `eval-smoke`-based seeder
  writes a `.eval-smoke` marker into the tree it owns, and Step 3.2 checks
  that marker automatically. A fixture seeded some other way must name at
  least one concrete file or marker path it creates, so Step 3.2 has
  something deterministic to check instead of inferring one from prose.
- **`no seeding required — clean target`** — this exact phrase, for a `happy`
  fixture that genuinely means "run against an empty target, nothing to
  seed." This is the common case, not an exception: most of the ~90 skills
  this harness exists to cover (this skill's own `dependencies.hard: []`
  included) have no `eval-smoke` scope and no seed step at all, and Step 3.2
  must be able to tell that apart from a bullet that simply forgot to name a
  command.

A bullet that does neither — no command, no explicit no-seed marker — is
the one case Step 3.2 halts on; do not write one.

Then freeze it for this run (Bash), passing every value already computed in
Step 1 rather than letting the tool default them — a defaulted `target`,
`cache-version`, or `tree-clean` writes a wrong fidelity header into `run.json`
for the life of the run, silently, since nothing re-checks it later:

```
node "${CLAUDE_PROJECT_DIR}/tools/skill-test.mjs" criteria <skill> --freeze <runDir> \
  --target <target-from-1.2> --tree-clean <clean-from-1.4-guard> \
  --cache-version <pluginCacheVersion-from-1.5> --scope <scope-from-1.2>
```

`<runDir>` is `tests/skill-test-runs/<skill>-<YYYY-MM-DD-HHMM>/`, computed once
now and reused for the whole run. `--tree-clean` takes the literal string
`true` or `false` from Step 1.4's `guard` output — this is the field
`report.mjs` reads to say "the working tree was already dirty when the run
started" versus "no fixes were applied," and defaulting it to `true` would
render a fix-blocked-by-dirty-tree run as if no fix had even been attempted.
`--cache-version` takes Step 1.5's resolved directory name (or `unknown` if the
cache path did not exist — pass that literal string, don't leave the flag off).
`--target` takes the resolved `<target>` from Step 1.2, `--scope` the resolved
scope list from Step 1.2 (comma-joined, e.g. `contract,dispatch,quality`).

This writes the criteria file's SHA-256 and its ordered **in-scope**
criterion-id list, plus these four values, into `<runDir>/run.json`; iterations
2 and 3 re-verify the hash and the run aborts (exit 4) on drift — the rubric
cannot shift mid-run.

Two things to note in its output. It prints `N of M criteria in scope <list>`:
if `N < M`, say so when you relay the result — the criteria it dropped were
not graded and a pass does not cover them. And if `--scope` selects **none**
of the file's criteria it exits 1 with the dimensions the file actually
contains; widen `--scope` and re-freeze rather than proceeding.

**If Step 2 derived the rubric rather than finding one**, the new
`tests/skill-criteria/<skill>.md` is a tracked-path file that this run leaves
uncommitted. Remember that: Step 5 stages it, and on a report-only run Step 6
has to tell the user to commit it — an untracked file there makes the *next*
run's `guard` report a dirty tree, which silently downgrades that run's
`--fix` to report-only.

## Step 3 — Iterate (bounded at `effectiveCap` iterations from Step 1.2 — 3 on a
`--fix` run, 1 on a report-only one, unless `--iterations` or the Step 1.6
cost-control answer set it — and at 3 consecutive invalid dispatches)

Track one counter across the whole run: `consecutiveInvalid`, starting at 0. This
exists because `converged()` deliberately excludes `invalidDispatch` iterations
from its cap — a runner that keeps reaching for the Skill tool despite
the explicit prohibition would otherwise loop forever, since nothing in the
deterministic tooling counts total dispatch *attempts*, only valid ones. **This
loop is the only place that bound is enforced, so enforce it exactly as written.**

For iteration `N` = 1 .. `effectiveCap` (stop looping as soon as any step below
says so):

1. **Drift check** (N ≥ 2 only): `node tools/skill-test.mjs criteria <skill> --check <runDir>`.
   A non-zero exit means the rubric changed mid-run — stop immediately: Edit
   `<runDir>/run.json` (Edit tool) to set `"stopReason": "criteria-drift"`, do
   not seed another iteration, and go straight to Step 6 to report it.
2. **Seed:** `node tools/skill-test.mjs seed <target> --skill <skill> --fixture happy`
   (or the active robustness fixture). Deletes iteration N−1's tree under the
   ownership marker and starts clean — iteration N never inherits N−1's mess.

   **The marker is not the fixture.** `seed` writes only the ownership marker
   and the fixture's *name* into it — the target now has an empty
   `.twt-skill-test-owned` and nothing else a skill could read. Look up the
   active fixture (`happy`, unless a robustness fixture is active) in this
   skill's criteria file `## Fixtures` section (read back in Step 2, which now
   requires every bullet to resolve one of three ways below — never an
   ambiguous fourth) and act on which one it is:

   - **Seeded** (the bullet names a runnable command, e.g.
     `node tools/eval-smoke.mjs seed <target> --scope ia`): run **that exact
     command** (Bash) against `<target>` now — read the bullet, don't assume
     the form above applies to every skill. Capture its stdout: `eval-smoke`
     seeders print a suggested dispatch line (e.g. `twt-ia-define with:
     subagent-collect — project brief: "..."`) — keep that string; step 3
     below uses it as this iteration's `--args` when the run's own `--args`
     (Step 1.2) wasn't given.

     **Verify materialization against a concrete path before proceeding** —
     never on faith. For an `eval-smoke`-based command, Glob/Read for the
     `.eval-smoke` marker it always writes into the tree it owns (e.g.
     `.twt-artifacts/pre-design/.eval-smoke` for `--scope ia`); for any other
     seeding command, check the specific file the `## Fixtures` bullet names.
     A fixture whose files were never written makes every exclusion-list
     criterion (e.g. "nothing outside `ia/`") pass vacuously, which is a false
     green, not a shortcut.
   - **`no seeding required — clean target`** (the bullet's literal text):
     proceed straight to step 3 below with `<target>` exactly as `seed` left
     it — marker only, nothing else. This is the expected, common state for a
     leaf skill with no seed step, not a gap to fill in, and it must NOT
     trigger the halt below.
   - **Neither** — the bullet names no runnable command and does not carry
     the literal no-seed marker: **stop the run now** with a loud, explicit
     error to the user instead of continuing against an ambiguously-specified
     target. Say plainly that the rubric's `## Fixtures` bullet for the active
     fixture is neither a runnable seed command nor an explicit no-seed
     marker, and name which fixture. Do not fall back to running the skill
     against an empty target and do not invent a seeding command that isn't
     written in the criteria file.
3. **Inject:** `node tools/skill-test.mjs inject <skill> --run <runDir> --target <target> --iteration N [--args="..."]`.
   **Always use the `--args="..."` form, not a space-separated `--args "..."`**
   — the value can legitimately start with `--` (a skill's own flag), and only
   the `=` form survives that intact. `--args` is the run's own `--args` from
   Step 1.2 when the user gave one; otherwise it is the dispatch-arguments
   string the fixture seeder printed in step 2 above. This reads
   `skills/<skill>/SKILL.md` **fresh from disk this
   iteration** — the entire point of the mechanism (design spec section 2.2) —
   rewrites every `${CLAUDE_PLUGIN_ROOT}` to the repo root, and writes
   `<runDir>/iteration-N/prompt.md`. Read that file's content: it is the
   runner's prompt, verbatim, with no additions or edits.
4. **Dispatch the runner.** Agent tool, `subagent_type: general-purpose`, the
   prompt from step 3 verbatim and nothing else appended. This is close to what
   the Skill tool does anyway (it inlines a SKILL.md into context) and was
   confirmed behaviourally equivalent to Skill-tool dispatch for a leaf skill on
   2026-08-26. A failure here is the finding, never something to prompt around
   — do not re-dispatch with extra hints (`/twt-eval-smoke`'s discipline).
5. **Invalid-dispatch check.** The injected prompt explicitly forbids calling the
   Skill tool for `twt:<skill>` or any other `twt:` skill. Check the runner's
   returned report and any visible transcript for evidence it happened anyway,
   and independently check whether this repo's own `.twt-artifacts/` tree
   gained anything matching the skill's declared `writes:` (a real Skill-tool
   call would run against this repo as its project root, not `<target>`). If
   either signals a violation:
   - Increment `consecutiveInvalid`. Write both `<runDir>/iteration-N/verdicts.json`
     (raw grader output — none ran, so `{}`) and `<runDir>/iteration-N/verdict-map.json`
     (the reduced map `ledger` reads — also `{}`) and record it:
     `node tools/skill-test.mjs ledger <runDir> --iteration N --verdicts <path-to-verdict-map.json> --invalid-dispatch true`.
     Do not dispatch the grader and do not attempt a fix for this iteration —
     the artifacts, if any, came from the stale cached copy and say nothing
     about the working-tree edit.
   - **If `consecutiveInvalid` reaches 3, stop the run now.** Do not seed another
     iteration. Edit `<runDir>/run.json` directly (Edit tool) to set
     `"stopReason": "invalid-dispatch-cap"`, then go to Step 6. Report this
     plainly as a finding about the *runner*, not the skill.
   - Otherwise, continue to the next iteration (back to step 1 of this loop).
6. **Valid dispatch:** reset `consecutiveInvalid` to 0.
7. **Root-honouring check.** Glob `<target>` for the artifacts the skill's
   `writes:` declares. If they are missing there but present under this repo's
   own `.twt-artifacts/` instead, the skill ignored the project-root override —
   record it as its own contract `BLOCKER` now:
   `node tools/skill-test.mjs finding <runDir> --tier BLOCKER --title "root-honouring violation" --where "<skill>, target <target>" --problem "artifacts landed under this repo's .twt-artifacts/ instead of the relocated <target>" --recommendation "resolve the project root from the injected preamble instead of assuming the repo root"`,
   and for any remaining iteration fall back to seeding `<target>` at this
   repo's root with a clearly stated warning in the report.
8. **Blind grader.** Agent tool, `subagent_type: general-purpose`, fresh context.
   The prompt must contain the following **verbatim**, since prompt-blinding is
   the only blinding this design has (the grader is not sandboxed and could read
   the skill source if it wandered):

   ```
   You are grading artifacts against a fixed rubric. Read ONLY the criteria file and
   the artifacts under the target directory named below. Do NOT read any file under
   skills/, do NOT read prior reports, and do NOT look for the source of the skill
   that produced these artifacts — your verdict must rest on the artifacts alone.

   For each criterion output: id, verdict (PASS | FAIL | UNVERIFIABLE), and evidence
   (a file path with line number, or a command and its output). A verdict without
   evidence must be reported as UNVERIFIABLE, not PASS.
   ```

   Follow it with the concrete, run-specific facts the grader needs and nothing
   else: the criteria file's absolute path, the target directory's absolute
   path, and — when `--scope` dropped any criterion — the exact list of
   criterion ids to grade, copied from `criteriaIds` in `<runDir>/run.json`,
   with the instruction to ignore every other criterion in the file. Do **not**
   give it the tested `SKILL.md`, the injected prompt, any prior iteration's
   report, or the runner's reasoning.
9. Write the grader's **raw response** verbatim to `<runDir>/iteration-N/verdicts.json`
   (Write tool). Spec §6 defines this file as raw grader output — evidence and
   all — and it is the only place that evidence survives to disk; do not
   reduce it before writing it here. Then, from that same response, build the
   flat verdict map `{ "C-001": "PASS", "C-002": "FAIL", ... }` — one entry
   per id in `<runDir>/run.json`'s `criteriaIds` (the frozen **in-scope** list,
   which is what `converged()` reads; an out-of-scope criterion gets no entry
   at all, not an `UNVERIFIABLE` one), defaulting to `UNVERIFIABLE` for any
   in-scope criterion the grader did not address — and write *that* reduced map
   separately to `<runDir>/iteration-N/verdict-map.json` (Write tool); Step 11's
   `ledger` call reads this second file, never `verdicts.json`. Keep the
   grader's cited evidence in context; it feeds this iteration's fix (Step 4,
   below) and the final report.
10. **Fix, only if `--fix` and this iteration's verdict map has any non-`PASS`
    entry.** Go to Step 4 now, before the ledger call, so the fix this round
    produced is recorded against this same iteration.

    A fix is only ever evidenced by the *next* valid iteration's verdicts, so a
    fix applied when `N == effectiveCap` is never re-graded — `report.mjs`
    marks it `UNVERIFIED` and flags the commit that carries it. Still apply it
    (a described, landed edit is more use to a human than a finding alone), but
    say so when you relay: this edit rests on the grader's evidence, not on a
    verdict.
11. **Ledger:** `node tools/skill-test.mjs ledger <runDir> --iteration N --verdicts <runDir>/iteration-N/verdict-map.json [--fixes <comma-list from Step 4>]`.
12. **Stop check:** `node tools/skill-test.mjs converged <runDir> --cap <effectiveCap>`.
    This also writes `stopReason` into `run.json`. Act on the result:
    - `continue` — loop to iteration N+1 (skipped if N was already `effectiveCap`:
      this loop's own bound on `N`, not the tool, is what stops the run there.
      `converged()` counts only **valid** iterations toward `--cap`, so an
      invalid-dispatch iteration can leave the valid count under the cap even
      at the last attempted `N` — in that case `converged()` legitimately
      still returns `continue`, and `stopReason: continue` is what lands in
      the report, not `iteration-cap`. (An earlier version of this doc claimed
      the tool itself enforces the cap and always returns `iteration-cap`
      here — that is false; this loop's own `N` bound is the only thing that
      stops the run when invalid dispatches are in the mix.)
    - anything else (`converged-pass`, `converged-pass-weak`, `no-progress`,
      `iteration-cap`) — stop looping now, regardless of iterations remaining,
      and go to Step 5.

## Step 4 — Fix (only under `--fix`)

Read the grader's findings (kept in context from Step 3.9), the artifacts under
`<target>`, and `skills/<skill>/SKILL.md`. Edit **only** files under
`skills/<skill>/`. A finding that points anywhere else — shared `tools/`,
`CONVENTIONS.md`, a dependency skill, a vendored kernel copy — becomes a
**proposed patch**, described but not applied. Record it now so it survives to
the report even if the run stops before Step 6:
`node tools/skill-test.mjs finding <runDir> --tier <BLOCKER|WARNING|SUGGESTION> --title "<short title>" --where "<file:line>" --problem "<the grader's evidence>" --recommendation "<what should change>" --out-of-boundary true --patch="<the specific edit you would make, described concretely>"`.
**Use `--patch="..."`, not a space-separated `--patch "..."`** — a pasted diff
routinely starts with `---`, and only the `=` form survives that.

Two absolute prohibitions, no exceptions:
- **Never edit the `version:` field.** The auto-bump Stop hook owns it; a manual
  bump here double-bumps.
- **Never write to `tests/skill-criteria/`.** Softening the rubric mid-loop is
  the exact failure mode that makes a self-grading harness worthless (Step 2).

Return to Step 3 with the list of files you touched (for `--fixes`); the next
iteration's Step 3.3 re-reads them fresh from disk, which is how the loop sees
its own fix.

## Step 5 — Land (only if fixes were applied this run, and only if `mayCommit`)

Skip this step entirely on a report-only run, on a run where no fix was ever
applied, or where Step 1.4's `guard` reported `mayCommit: false` (tree was dirty
at the start — state this plainly in the report instead).

1. `node tools/gen-docs.mjs` — a skill change and its regenerated docs land in
   the same commit, per the standing repo rule.
2. Stage explicitly, never `git add -A`: `git add skills/<skill>/ SKILLS.md architecture.md README.md`.
   **Add `tests/skill-criteria/<skill>.md` to that list if Step 2 derived it
   this run.** It is a tracked-path file; leaving it untracked makes the next
   run's Step 1.4 `guard` report a dirty tree and silently downgrade that run's
   `--fix` to report-only. Committing a rubric Step 2 *created* is not the
   prohibited act — Step 4's ban is on *editing* a frozen rubric mid-loop.
3. One commit on `main` (no branches, no worktrees):
   `git commit -m "fix(<short-name>): address /twt-skill-test findings"`.
4. **Stop. Do not push, ever** — there is no push flag in this design and none
   should be added.
5. Edit `<runDir>/run.json` (Edit tool) to set `"commit": "<sha>"` from the
   commit just created, so `report` can name it.

The skill never bumps a version and never edits `marketplace.json` — the
auto-bump Stop hook does both, landing its own `chore:` commit next turn. That
two-commit shape is this repo's established pattern.

## Step 6 — Report

Run: `node tools/skill-test.mjs report <runDir>`. This writes `<runDir>/report.md`
with the fidelity header, the stop reason, the per-iteration verdict table, any
applied fixes, and the landing outcome.

Relay to the user, in this order:
1. The stop reason, stated plainly in one sentence (including
   `invalid-dispatch-cap` if that fired — say explicitly this is a finding about
   the *runner*, not the skill).
2. The verdict table (criterion × iteration).
3. Every proposed out-of-boundary patch from Step 4, if any.
4. Any fix marked `UNVERIFIED` in the report — name the iteration and say
   plainly that no verdict backs it.
5. If `--scope` dropped any criterion (Step 2's freeze printed `N of M`), name
   the dimensions that went ungraded — a pass does not cover them.
6. If Step 2 derived the rubric and Step 5 did not run (report-only, or
   `mayCommit: false`), tell the user that `tests/skill-criteria/<skill>.md` is
   new and uncommitted, and that leaving it so will make the next run's guard
   see a dirty tree.
7. **Always state:** nothing was pushed, and the plugin cache your other
   sessions load from (`cache/twt-marketplace/twt/<version>` recorded in Step
   1.5) is unaffected — if a fix was committed, it stays local to this working
   tree until a human pushes it.
8. The report file's path.

Target-dir handling: on `converged-pass` (not `-weak`), clean it up —
`node tools/skill-test.mjs clean <target>`. On every other stop reason, leave it
in place so the artifacts can be inspected, and say so.
