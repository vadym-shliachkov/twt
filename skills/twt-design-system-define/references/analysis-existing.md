# Analyse-existing procedures (twt-design-system-define)

Loaded on demand from SKILL.md Step 3 — only when a Figma/site source or an
existing design system is in play (or mode ∈ 3 / 7). Greenfield runs never
read this file. Step numbering continues SKILL.md's.

## Step 3b — Figma + Existing System Branch

Run this only when **both** conditions are true:
- `<existing_system_present> = true` (from Step 1b)
- at least one Figma source was added in Step 3

Otherwise skip to Step 4.

Print a diff summary first — read variables / styles from the Figma source(s) and compare against `<existing_system>`:

```
Compared Figma to existing tokens.md:
  • Tokens matching                : <n>
  • Tokens new in Figma (missing)  : <n>
  • Tokens with different values   : <n>
  • Tokens only in existing system : <n>
```

Then ask via the **AskUserQuestion** tool (single-select, header "Apply Figma?") how the Figma file should be applied to the existing design system:
- **Update** — add only the tokens missing in tokens.md (recommended; safest, preserves consistency)
- **Adjust** — review each conflict and decide per-token (add / replace / skip)
- **Regenerate** — discard the existing system and rebuild from Figma (destructive — confirms twice)
- **No change** — keep tokens.md as-is, just use it as context for the current task
- **You decide** — I apply the safest fit (defaults to Update; never Regenerate without explicit confirmation)

Record the choice and continue. Record the choice as `<system_update_mode>`. Apply it in Step 5 and Step 10:

| Choice | Step 5 behavior | Step 10 (write) behavior |
|--------|-----------------|--------------------------|
| **1 — Update** | Extract Figma tokens, drop any whose name+role already exists in `<existing_system>`. Keep only the missing ones. | Merge: existing sections preserved verbatim; new tokens appended into matching sections with `(added from <figma source>)` note. |
| **2 — Adjust** | Build a conflict list (same name, different value) and an additions list. Walk through each conflict with the user: `keep existing / replace with Figma / skip`. | Apply per-token decisions. Log every change in the new Section 10 (Migration Recommendations) entry titled "Adjustments applied on <date>". |
| **3 — Regenerate** | Ignore `<existing_system>`. Use Figma + other sources as the only basis. **Before writing**, ask once more: `Type REGENERATE to confirm destructive rewrite.` If anything else is typed, fall back to Update. | Back up the old file to `tokens.md.bak` first (overwriting any previous backup — one rolling backup, not an accumulating series; git history covers the rest), then write fresh. |
| **4 — No change** | Skip token extraction merge entirely. Use `<existing_system>` as-is for downstream work (component hierarchy, exports). | Do not modify `tokens.md`. Completion summary notes `Output file: unchanged`. |

In **Adjust** mode, render the conflict walkthrough as a compact table the user can answer with a single line of letters, e.g.:

```
# Conflicts (existing vs Figma):
1. color-primary       #0057FF → #1A5CFF    [k]eep / [r]eplace / [s]kip
2. radius-card         12px    → 16px       [k]eep / [r]eplace / [s]kip
3. space-4             16px    → 12px       [k]eep / [r]eplace / [s]kip

Answer with one letter per line (e.g. "k r k") or "k all" / "r all".
```

---

## Step 4 — Existing System Reconciliation

**Skip this step entirely if `<existing_system_present> = true`** (Step 1b already loaded it and Step 3b already decided how to apply Figma to it).

Otherwise, ask via the **AskUserQuestion** tool (single-select, header "Existing DS?") whether there is an existing design system to extend:
- **Yes** — point to an existing system (tokens file, CSS, Storybook, or Figma) to use as the priority baseline
- **No** — generate from the sources collected above
- **You decide** — I detect whether an existing system is present and proceed accordingly (defaults to No when none is found)

Record the choice and continue. If **Yes**, ask the user to provide the path/URL to the existing system, read it in full and treat it as the **priority baseline**:
- Existing token names and values are preserved verbatim.
- New tokens are added only where the analyzed designs introduce values with no equivalent.
- Conflicts are logged in the Pattern Report (Step 7), never silently overwritten.

If **No**, derive everything from the collected sources.

---

## Step 7 — Pattern & Inconsistency Report

Scan extracted tokens and components for:

- inconsistent spacing
- typography drift (same role, different size/weight)
- duplicate button variants
- mismatched radii
- color misuse (semantic role conflicts with token meaning)
- layout fragmentation
- naming drift

For each finding, record:
- **What** (the inconsistency)
- **Where** (source tag, screen, or component)
- **Recommendation** (normalize to X, retire Y)
- **Severity** (high / medium / low)

In **mode 3** (multi-file merge) also produce:
- conflict report (token name same, value different)
- normalization recommendations
- migration notes (which file's value wins and why)

In **mode 7** (inconsistency compare) this section is the primary output.

---

## Step 8 — Multi-File Merge Logic

Only run if more than one Figma source was provided, or **mode 3** was selected.

Steps:
1. Build a per-file token map.
2. Group tokens by semantic role across files.
3. Resolve conflicts using this order: existing-system value > most-frequent value > most-recent file > flagged for human review.
4. Output a merged token set + a conflict table that shows every value that was *not* chosen and the file it came from.
5. Preserve the scalable architecture — never collapse two distinct semantic roles into one even if the value matches.
