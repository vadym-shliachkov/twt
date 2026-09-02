// Pure, side-effect-free helpers behind gen-docs.mjs's shared-block stamper.
// Split into their own module (no file I/O here) so tests can exercise the
// fence-aware scanning logic directly without importing gen-docs.mjs itself —
// that file performs real reads/writes against the repo as soon as it runs.

// Index of the next line starting with "## " that is NOT inside a fenced
// code block (``` ... ``` or ~~~ ... ~~~), or -1 if none. A block's own
// canonical text can itself contain an example "## " line inside a fence
// (e.g. a fenced example inside a canonical block) — a naive /^## /m scan
// would mistake that for the section's real end boundary and truncate the
// re-stamp on every later run, causing the block to grow without bound.
//
// Both CommonMark fence delimiters are tracked independently (a document, or
// a canonical block's own example text, can use either or both): a ~~~ line
// must never close a ``` fence, and a ``` line must never close a ~~~ fence.
export function nextHeadingIndex(text) {
  const lines = text.split("\n");
  let offset = 0;
  let inBacktick = false;
  let inTilde = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed) && !inTilde) inBacktick = !inBacktick;
    else if (/^~~~/.test(trimmed) && !inBacktick) inTilde = !inTilde;
    else if (!inBacktick && !inTilde && /^## /.test(line)) return offset;
    offset += line.length + 1;
  }
  return -1;
}

// Replace the body of the section starting at `heading` (up to but not
// including the next real "## " heading) with `block`'s canonical text.
// No-op if `block` is falsy or `heading` isn't found in `text`.
export function syncBlock(text, { text: block, heading }) {
  if (!block) return text;
  const m = text.match(heading);
  if (!m) return text;
  const start = m.index;
  const afterHeading = start + m[0].length;
  const next = nextHeadingIndex(text.slice(afterHeading));
  const end = next === -1 ? text.length : afterHeading + next;
  return text.slice(0, start) + block + "\n\n" + text.slice(end);
}

// Replace a leading blockquote block (a contiguous run of lines starting with
// ">") identified by `anchor` — a regex matching the block's FIRST line — with
// `block`'s canonical text. Unlike syncBlock this is not heading-delimited:
// the trace self-logging notice sits above any "## " heading, as a "> …" quote.
// The block is the maximal run of consecutive ">"-prefixed lines starting at
// the anchor line. No-op if `block` is falsy or `anchor` isn't found.
export function syncBlockquote(text, { text: block, anchor }) {
  if (!block) return text;
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (anchor.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return text;
  let end = start;
  while (end < lines.length && /^>/.test(lines[end])) end++;
  const canonical = block.replace(/\r\n/g, "\n").trimEnd().split("\n");
  return [...lines.slice(0, start), ...canonical, ...lines.slice(end)].join("\n");
}

// Apply every registered { text, heading } block to `text` in turn. Each
// block only touches a file that carries its own heading (syncBlock no-ops
// otherwise).
export function syncSetupGate(text, blocks) {
  return blocks.reduce((t, b) => syncBlock(t, b), text);
}
