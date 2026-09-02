// resolve-playwright.mjs — find the npm `playwright` package wherever the user
// actually installed it.
//
// A bare `import('playwright')` resolves from THIS package's directory (the
// plugin root), while `node -e "import('playwright')"` resolves from the CWD —
// so the old detection and the old runtime import could disagree, and a
// playwright installed in the target project or globally was never found at
// all. The result: skills kept asking the user to install a package they
// already had. This resolver tries, in order:
//
//   1. plugin-root resolution (a dependency of the marketplace itself)
//   2. the target project's node_modules (resolved from process.cwd())
//   3. the global npm root (`npm root -g`)
//
// Returns { pw, how } — pw is the module or null, how names the source.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export async function loadPlaywright() {
  try { return { pw: await import('playwright'), how: 'plugin' }; } catch { /* next */ }
  try {
    const req = createRequire(path.join(process.cwd(), 'noop.js'));
    const resolved = req.resolve('playwright');
    return { pw: await import(pathToFileURL(resolved).href), how: 'project' };
  } catch { /* next */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (root && fs.existsSync(path.join(root, 'playwright'))) {
      const req = createRequire(path.join(root, 'noop.js'));
      const resolved = req.resolve('playwright');
      return { pw: await import(pathToFileURL(resolved).href), how: 'global' };
    }
  } catch { /* fall through */ }
  return { pw: null, how: 'none' };
}

// Full usability check: package resolvable AND Chromium browser installed
// (launch is the only reliable test for the browser binary).
export async function detectPlaywright() {
  const { pw, how } = await loadPlaywright();
  if (!pw) return { playwright: false, chromium: false, how };
  try {
    const browser = await pw.chromium.launch();
    await browser.close();
    return { playwright: true, chromium: true, how };
  } catch {
    return { playwright: true, chromium: false, how };
  }
}
