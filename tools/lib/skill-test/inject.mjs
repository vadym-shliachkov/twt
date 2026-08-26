// inject.mjs — build the runner prompt from the WORKING TREE SKILL.md.
//
// Why not the Skill tool: the installed plugin is a version-pinned GitHub clone
// (~/.claude/plugins/cache/twt-marketplace/twt/<version>/), so a working-tree
// edit is invisible to it until pushed AND re-resolved. A loop built on Skill-tool
// dispatch would grade identical bytes every iteration and report no-progress
// forever while appearing to work. See spec §2.2.
const PLUGIN_ROOT = /\$\{CLAUDE_PLUGIN_ROOT\}/g;

export function prepareInjection(skillMd, { projectRoot, repoRoot, args }) {
  let substitutions = 0;
  const body = skillMd.replace(PLUGIN_ROOT, () => { substitutions++; return repoRoot; });

  const prompt = [
    `Treat \`${projectRoot}\` as the project root for this task: every artifact path`,
    `named relative to the project root resolves under it. Do not write anywhere else.`,
    ``,
    `Do NOT call the Skill tool for this skill or any other twt: skill. The`,
    `authoritative instructions are inlined below; the installed plugin copy is a`,
    `pinned older version, and invoking it would invalidate this run.`,
    ``,
    `Follow the instructions between the delimiters exactly as written.`,
    ``,
    `--- BEGIN SKILL ---`,
    body,
    `--- END SKILL ---`,
    ``,
    args ? `Arguments: ${args}` : `Arguments: (none)`,
  ].join('\n');

  return { prompt, substitutions };
}
