---
name: twt-figma-read
surface: internal
user-invocable: false
category: figma
family: figma
role: tool
unit: twt-figma-read
trigger: model
description: (v1.0.0) Read a Figma design accurately before implementing it — metadata-first node-tree read with variable-backed tokens, measured vs estimated kept honest
version: 1.0.0
model: sonnet
effort: medium
accepts_arguments: true
inputs:
  - a Figma file, frame, or node URL (in $ARGUMENTS, or already in the conversation)
dependencies:
  hard: []
  soft:
    - figma-mcp
reads: []
writes: []
---

# /twt-figma-read

## Intent

**Purpose:** Make one Figma read trustworthy, wherever it happens. The pipeline skills each read Figma as a step inside a larger job; this skill is the same discipline available on its own, for the far more common case — ordinary project work where someone points at a Figma frame and asks for it to be built. Without it, an ad-hoc read reaches for `get_design_context` and a screenshot, skips the file's variables entirely, and hands back hex codes and pixel numbers with no way to tell a design token from a one-off value.

**Non-goals:**
- Does not write artifacts, and does not create a `.twt-artifacts/` tree — it is a reading discipline, not a pipeline phase
- Does not implement the design; it hands back a faithful reading for whatever build step follows
- Does not replace `figma:figma-design-to-code` — it loads it and adds to it
- Does not measure a built page against the design (that is `/twt-fidelity`)

**Success criteria:**
- Every value reported is traceable to a node in the tree or explicitly labelled an estimate
- Variables are resolved to names wherever a value binds to one
- The reply states plainly what was read and what was not (frames skipped, states not present, values guessed)

---

## Reading Figma — the measured read
Before the first `get_design_context` call, load the `figma:figma-design-to-code` skill — it is a mandatory prerequisite, and this block composes with it rather than replacing it. Then, for any design you are about to read:
- **`get_metadata` first.** It returns the cheap frame tree. Never open with `get_design_context` on a whole file — that is the call that blows the token budget on a large file and returns more than you can use.
- **`get_variable_defs` on every frame you read, always.** Figma variables are the highest-confidence token source in the file: where a value binds to a variable, carry the variable name alongside the raw value. A read that skips this hands you hex codes and pixel numbers with no way to tell a token from a one-off.
- **`get_design_context` for the node tree, `get_screenshot` only to corroborate.** A screenshot is evidence that your reading of the tree is right; it is never the measurement itself. Never infer a value from pixels that the node tree can state.
- **Say which values you measured and which you guessed.** Anything not read from the node tree is estimated — label it, and never let an estimate travel onward as if it were measured. Do not fabricate breakpoints, widths, or states you did not actually read: one frame is one frame, even when three were asked for.

## Step 1 — Resolve the target

Take the Figma URL from `$ARGUMENTS`, or from the conversation if one was already given. If there is none, ask for it as free-form text — a URL is not a fixed-option choice, so do not use AskUserQuestion here.

A URL carrying a `node-id` names a specific frame: that frame **is** the target, and you are done resolving. Without one, call `get_metadata` and treat the top-level frames as candidates.

If the file has several top-level frames and the request does not say which one, ask via **AskUserQuestion** (single-select, header "Frame") listing the candidate frame names plus **You decide** (I pick the one whose name or width best matches what was asked for). Never silently read all of them — on a large file that is the call that exhausts the context for no benefit.

## Step 2 — Read it

Apply the measured read above to the resolved frame. In practice that is `get_metadata` (already called if you resolved by frame list), then `get_design_context`, `get_variable_defs`, and `get_screenshot` for corroboration.

If the Figma MCP tools are not available in your tool set (nothing prefixed `mcp__plugin_figma_figma__`), say so and stop — do not substitute a screenshot the user pasted and present it as a design read. An image is a legitimate input, but it yields estimates, and it must be reported as such.

## Step 3 — Report the reading

Reply with, in this order:

1. **What you read** — file/frame name, node id, frame dimensions.
2. **Tokens** — every value that binds to a Figma variable, as `<variable name> = <raw value>`. This is the part an ad-hoc read normally loses, so lead with it rather than burying it.
3. **Structure** — the node tree flattened to the layout that matters: sections, their order, spacing, and the auto-layout direction/gap where present.
4. **Not read / estimated** — frames you skipped, component states not present in the file, and any value you inferred rather than read. If this section is empty, say so explicitly; an absent section reads as an oversight.

Keep it proportional: a reading is input to a build step, not a document. If the caller asked for the design to be implemented, hand this straight to that work rather than pausing for approval.
