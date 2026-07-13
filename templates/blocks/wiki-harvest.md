## Wiki harvest — capture this phase's decisions (skip if no wiki)
Check with Glob (never a shell command) that `.project-wiki/` exists at the project root; if not, skip this step silently — the wiki is opt-in and this must not change behavior for a project without one.

If it exists, run (Bash, single command):
`node "${CLAUDE_PLUGIN_ROOT}/tools/wiki-harvest.mjs" "$CLAUDE_PROJECT_DIR"`

It pulls this phase's decision-bearing content — `decisions.md` items, every `facts.md` ledger row (resolved facts must survive artifact deletion, not just CONFLICTs), validator BLOCKERs, session-log Q&A — into `.project-wiki/inbox.md`, and registers every other artifact in `sources.md`. Idempotent (`.harvest-state.json`), always exits 0 with a one-line summary such as `3 harvested, 5 already present. 12 inbox entries pending curation.` — a harvest problem must never fail or block this phase; if the tool errors, note it and continue.

Carry the summary line into this phase's Report step. **This is capture, not curation (§17):** it only appends to the inbox — no curated page is written here. Turning inbox entries into cited pages is `/twt-wiki`, user-invoked — never part of this run.
