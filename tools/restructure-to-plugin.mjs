// One-shot: move skills/<category>/twt-*.md into plugin layout.
// Orchestrators/tools -> commands/<name>.md ; sub-skills -> skills/<name>/SKILL.md
import { readFileSync, writeFileSync, mkdirSync, rmSync, globSync } from 'node:fs';
import { basename, join } from 'node:path';

const isSub = (n) => /-(define|validate)$/.test(n) || n === 'twt-brand-fetch';
const srcs = globSync('skills/*/twt-*.md'); // category subfolders only
let cmds = 0, subs = 0;
for (const src of srcs) {
  const name = basename(src, '.md');
  const text = readFileSync(src); // Buffer -> byte-exact, no BOM, CRLF preserved
  if (isSub(name)) {
    const dir = join('skills', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), text);
    subs++;
  } else {
    mkdirSync('commands', { recursive: true });
    writeFileSync(join('commands', `${name}.md`), text);
    cmds++;
  }
  rmSync(src); // remove only the original source file we just moved
}
console.log(`commands=${cmds} sub-skills=${subs}`);
