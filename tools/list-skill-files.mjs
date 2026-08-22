#!/usr/bin/env node
// Prints every skill file in the repo, one absolute path per line, across ALL
// plugins in .claude-plugin/marketplace.json. CI shells out to this instead of
// globbing commands/ and skills/ directly, so a plugin split out under
// ./plugins/<name> is linted the moment it is registered — no workflow edit.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { skillFiles } from "./lib/plugin-roots.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const { path } of skillFiles(ROOT)) console.log(path);
