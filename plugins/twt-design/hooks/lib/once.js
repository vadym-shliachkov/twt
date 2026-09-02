#!/usr/bin/env node
/**
 * once - duplicate suppression for hook scripts.
 *
 * WHY THIS EXISTS
 *
 * Every generated unit ships the whole hooks/ directory, because filtering
 * hooks per unit would need a hook -> skill map that does not exist. So a user
 * with two twt plugins installed (a unit plus the bundle, or two units) has the
 * same hook script registered twice and runs it twice per tool call. Making the
 * scripts idempotent is smaller than the filtering it replaces, and it fixes
 * the pre-existing bundle-plus-unit case too.
 *
 * THE KEY
 *
 * session_id plus a hash of the whole payload. The payload carries no tool-use
 * id the scripts can rely on, and an identical payload inside one session IS
 * the duplicate case. A caller that wants once-per-SESSION semantics instead
 * (the figma-read guard, which nags about reading discipline exactly once)
 * passes a payload reduced to just the session id - same mechanism, no second
 * code path.
 *
 * FAILING OPEN
 *
 * Every error path returns true, i.e. "go ahead and act". A hook that cannot
 * write a marker must still run: failing closed would silently disable the
 * scope guard, which is a security control. Duplicate output is a nuisance; a
 * disabled guard is a hole.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOUR = 60 * 60 * 1000;
const PREFIX = 'twt-hook-';

/**
 * @param {string} name  hook identifier, e.g. 'scope-guard'
 * @param {string} payloadText  the raw stdin payload
 * @param {string} [dir]  marker directory; defaults to the system temp dir
 * @returns {boolean} true the first time this (name, session, payload) is seen
 */
function once(name, payloadText, dir) {
  try {
    const base = dir || os.tmpdir();
    let session = 'nosession';
    try {
      const parsed = JSON.parse(payloadText);
      if (parsed && typeof parsed.session_id === 'string' && parsed.session_id) {
        session = parsed.session_id;
      }
    } catch (e) { /* a non-JSON payload still hashes fine */ }
    session = String(session).replace(/[^a-zA-Z0-9_-]/g, '_') || 'nosession';

    const hash = crypto.createHash('sha1').update(String(payloadText)).digest('hex').slice(0, 16);
    const safeName = String(name).replace(/[^a-zA-Z0-9_-]/g, '') || 'hook';
    const marker = path.join(base, PREFIX + safeName + '-' + session + '-' + hash);

    if (fs.existsSync(marker)) return false;
    fs.writeFileSync(marker, String(Date.now()));
    prune(base);
    return true;
  } catch (e) {
    return true;
  }
}

// Markers are per tool call, so a long session would otherwise leave thousands
// behind. Best effort: a temp dir this process cannot read is not this hook's
// problem to solve.
function prune(dir) {
  try {
    const cutoff = Date.now() - HOUR;
    for (const f of fs.readdirSync(dir)) {
      if (f.indexOf(PREFIX) !== 0) continue;
      const p = path.join(dir, f);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      } catch (e) { /* raced with another hook process */ }
    }
  } catch (e) { /* unreadable temp dir */ }
}

module.exports = { once };
