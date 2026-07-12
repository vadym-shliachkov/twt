## Wiki harvest — capture this phase's decisions (skip if no wiki)
Use Glob to check whether `.project-wiki/` exists at the project root (`$CLAUDE_PROJECT_DIR/.project-wiki/`) — never a shell command. If it does not exist, skip this step silently: the wiki is opt-in, and this must not change behavior for a project that hasn't adopted it.

If it exists, run the harvester (Bash, single command) to pull this phase's decision-bearing content into the inbox:
`node "${CLAUDE_PLUGIN_ROOT}/tools/wiki-harvest.mjs" "$CLAUDE_PROJECT_DIR"`

It scans `.twt-artifacts/` for open items in every `decisions.md`, every status row in `facts.md` (the ledger's only path into the wiki — resolved facts must survive artifact deletion, not just CONFLICTs), BLOCKER findings in each `validation-report.md`, and session-log Q&A, then appends decision-bearing entries to `.project-wiki/inbox.md` and adds a `sources.md` row for everything else. It is idempotent (tracked in `.project-wiki/.harvest-state.json`, so a re-run never re-adds what's already there) and always exits 0, printing a one-line summary such as `3 harvested, 5 already present. 12 inbox entries pending curation.` — a harvest problem must never fail or block this phase; if the tool errors for any reason, note it and continue to the Report step regardless.

Carry the harvester's summary line into this phase's Report step. **This is capture, not curation (§17):** it only appends to the inbox — no curated page (`decisions/`, `entities/`, `ideas/`, `facts.md`, `open-questions.md`, `glossary.md`, `index.md`, `overview.md`) is written here, and none should be. Turning inbox entries into a cited page is a separate, user-invoked step — point to `/twt-wiki` — never do it as part of this run.
