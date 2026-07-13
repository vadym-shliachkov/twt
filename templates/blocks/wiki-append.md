## Wiki capture — record what you decided and why
If `.project-wiki/` exists at the project root (Glob/Read — never a shell command), append your reasoning to `.project-wiki/inbox.md` before finishing. The capture hook records what the **user** chose; this records what **you** decided and **why** — which nothing else in the pipeline preserves.

One entry per judgment a human would otherwise have to re-make:
- a decision made autonomously (collect mode, or an unattended run)
- a factual `CONFLICT` you resolved, or refused to resolve
- a validator BLOCKER you overruled, and on what grounds
- an idea you raised but did not scope
- a free-form answer the user typed at a plain-text prompt (the capture hook sees only AskUserQuestion menus) — put their words in **decision:** verbatim, not paraphrased

Append only — never rewrite; the curator drains it:

```
## <UTC timestamp, no milliseconds, e.g. 2026-07-11T14:03:22Z> · reason · <this skill's name>
- **decision:** <what you settled>
- **why:** <the evidence, tradeoff, or constraint that forced it>
- **evidence:** <path, URL, or artifact this rests on>
- **reversible:** <yes|no>
```

Write nothing else in `.project-wiki/` — curated pages have exactly one writer, and it is not you. No `.project-wiki/` → skip this step silently (the wiki is opt-in).
