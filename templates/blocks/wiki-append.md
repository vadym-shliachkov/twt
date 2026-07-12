## Wiki capture — record what you decided and why
If `.project-wiki/` exists at the project root (use Glob/Read to check — never a shell command), append your reasoning to `.project-wiki/inbox.md` before you finish. The wiki's capture hook already records what the **user** chose; this records what **you** decided and, crucially, **why** — which nothing else in the pipeline preserves.

Append one entry per judgment that a human would need to re-make if it were lost:
- a decision you made autonomously (collect mode, or an unattended run)
- a factual `CONFLICT` you resolved, or refused to resolve
- a validator BLOCKER you overruled, and on what grounds
- an idea you raised but did not scope
- a free-form answer the user typed at a plain-text prompt (a direction, a constraint, pasted guidance) that shaped what you produced — the capture hook sees only AskUserQuestion menus, so this is the one place a typed answer gets recorded; put their words in **decision:** verbatim, not paraphrased

Append (never rewrite — `inbox.md` is append-only, and the curator drains it):

```
## <UTC timestamp, e.g. 2026-07-11T14:03:22Z — no milliseconds, matching the capture hook> · reason · <this skill's name>
- **decision:** <what you settled>
- **why:** <the reason — the evidence, the tradeoff, the constraint that forced it>
- **evidence:** <path, URL, or artifact this rests on>
- **reversible:** <yes|no>
```

Write nothing else in `.project-wiki/`. Curated pages have exactly one writer, and it is not you.

If `.project-wiki/` does not exist, skip this step silently — the wiki is opt-in.
