// Reachable ONLY from skills/twt-beta/tools/local.mjs. Nothing else imports it,
// so it is vendored only if the build WALKS skill-local files rather than
// merely copying them.
export const onlyLocal = 2;
