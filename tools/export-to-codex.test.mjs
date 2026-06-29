#!/usr/bin/env node
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test("exports a Codex plugin without changing source marketplace layout", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "twt-codex-export-"));
  const out = join(tmp, "plugin");

  try {
    const result = spawnSync(
      process.execPath,
      ["tools/export-to-codex.mjs", "--out", out],
      { cwd: ROOT, encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const manifest = JSON.parse(
      await readFile(join(out, ".codex-plugin", "plugin.json"), "utf8"),
    );
    assert.equal(manifest.name, "twt-marketplace");
    assert.equal(manifest.skills, "./skills/");

    assert.equal(await exists(join(out, "skills", "twt-brand-define", "SKILL.md")), true);
    assert.equal(await exists(join(out, "skills", "twt-block-preview", "SKILL.md")), true);
    assert.equal(await exists(join(out, "tools", "ds-block-preview.mjs")), true);
    assert.equal(await exists(join(out, "tools", "export-to-codex.mjs")), false);
    assert.equal(await exists(join(out, "templates", "validation-report.md")), true);
    assert.equal(await exists(join(out, "hooks", "hooks.json")), false);
    assert.equal(await exists(join(out, "hooks", "twt-debug-log.js")), true);

    const converted = await readFile(
      join(out, "skills", "twt-block-preview", "SKILL.md"),
      "utf8",
    );
    assert.match(converted, /^name: twt-block-preview/m);
    assert.match(converted, /^# \$twt-block-preview/m);
    assert.match(converted, /Codex adaptation note/);
    assert.doesNotMatch(converted, /\$CLAUDE_PLUGIN_ROOT/);
    assert.doesNotMatch(converted, /\$CLAUDE_PROJECT_DIR/);

    const hook = await readFile(join(out, "hooks", "twt-debug-log.js"), "utf8");
    assert.doesNotMatch(hook, /CLAUDE_PROJECT_DIR/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
