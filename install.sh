#!/usr/bin/env bash
# twt — Skills Marketplace Installer  [LEGACY FALLBACK — prefer: /plugin marketplace add vadym-shliachkov/twt]
# Works on macOS and Linux.
#
# Usage:
#   bash install.sh                                 Install globally (~/.claude/commands) — every project
#   bash install.sh --target /path/to/project       Install into one project (<project>/.claude/commands)
#   bash install.sh --target . --with-figma-permissions   Also seed the Figma MCP permission allowlist
#   bash install.sh --target . --with-external-skills      Also install the external design skills via `npx skills`
#   bash install.sh --no-scope-guard                Skip the scope guard (seeded by default, global and --target)
#   bash install.sh --no-permissions               Skip the runtime permission allowlist (seeded by default)

set -e

TARGET=""
WITH_FIGMA_PERMISSIONS=0
WITH_EXTERNAL_SKILLS=0
NO_SCOPE_GUARD=0
NO_PERMISSIONS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --target=*) TARGET="${1#*=}"; shift ;;
    --with-figma-permissions) WITH_FIGMA_PERMISSIONS=1; shift ;;
    --with-external-skills) WITH_EXTERNAL_SKILLS=1; shift ;;
    --no-scope-guard) NO_SCOPE_GUARD=1; shift ;;
    --no-permissions) NO_PERMISSIONS=1; shift ;;
    *) echo "  Unknown argument: $1"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$SCRIPT_DIR/skills"

# Sub-skills (the *-define / *-validate workers + the brand-fetch helper) are dispatched only
# by their orchestrators, never typed directly. They install into .claude/skills/<name>/SKILL.md
# (still invocable via the Skill tool) instead of .claude/commands/, so they don't clutter the
# slash-command list. Everything else (orchestrators + standalone tools) stays a slash command.
is_sub_skill() {
  case "$1" in
    *-define|*-validate) return 0 ;;
    twt-brand-fetch)     return 0 ;;
    *)                   return 1 ;;
  esac
}

copy_command_with_version() {
  local src="$1"
  local dest="$2"
  local version
  version="$(awk -F':[[:space:]]*' '/^version:/ { print $2; exit }' "$src")"

  if [ -z "$version" ]; then
    cp "$src" "$dest"
    return
  fi

  awk -v version="$version" '
    BEGIN { in_fm = 0; done = 0; sub(/\r$/, "", version) }
    { sub(/\r$/, "") }
    NR == 1 && $0 == "---" { in_fm = 1 }
    NR > 1 && in_fm && $0 == "---" { in_fm = 0 }
    in_fm && !done && /^description:[[:space:]]*/ {
      if ($0 !~ "\\(v" version "\\)") {
        sub(/^description:[[:space:]]*/, "&(v" version ") ")
      }
      done = 1
    }
    { print }
  ' "$src" > "$dest"
}

# On Git Bash / MSYS, node resolves "/c/..." paths as drive-relative; convert
# them to native "C:/..." form. No-op on macOS/Linux.
to_native() {
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*)
      if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"
      else printf '%s' "$1" | sed -E 's#^/([a-zA-Z])/#\1:/#'; fi ;;
    *) printf '%s' "$1" ;;
  esac
}

# Resolve install location: project-local when --target is given, else global.
if [ -n "$TARGET" ]; then
  mkdir -p "$TARGET"
  TARGET_ROOT="$(cd "$TARGET" && pwd)"
  CLAUDE_DIR="$TARGET_ROOT/.claude"
  COMMANDS_DIR="$CLAUDE_DIR/commands"
  SCOPE="project ($TARGET_ROOT)"
else
  CLAUDE_DIR="$HOME/.claude"
  COMMANDS_DIR="$CLAUDE_DIR/commands"
  SCOPE="global ($HOME)"
fi
SKILLS_DEST_DIR="$CLAUDE_DIR/skills"

echo ""
echo "  twt Skills Marketplace — Installer"
echo "  ───────────────────────────────────"
echo "  Scope: $SCOPE"
echo ""

# Verify skills directory exists
if [ ! -d "$SKILLS_DIR" ]; then
  echo "  ERROR: skills/ folder not found next to install.sh"
  echo "  Make sure you're running this from the twt repo root."
  exit 1
fi

# Create the Claude commands directory if it doesn't exist
if [ ! -d "$COMMANDS_DIR" ]; then
  echo "  Creating $COMMANDS_DIR ..."
  mkdir -p "$COMMANDS_DIR"
fi

# Find and install all skill files recursively (skip category READMEs).
# Orchestrators + standalone tools -> .claude/commands/<name>.md (slash commands).
# Sub-skills (*-define / *-validate / brand-fetch) -> .claude/skills/<name>/SKILL.md (Skill-tool only).
INSTALLED=0
SKILLS_INSTALLED=0
while IFS= read -r -d '' file; do
  filename="$(basename "$file")"

  # Skip category README files
  [[ "$filename" == "README.md" ]] && continue

  cmd="${filename%.md}"

  if is_sub_skill "$cmd"; then
    skill_dir="$SKILLS_DEST_DIR/$cmd"
    mkdir -p "$skill_dir"
    dest="$skill_dir/SKILL.md"
    if [ -f "$dest" ]; then echo "  Updating  (skill): $cmd"; else echo "  Installing (skill): $cmd"; fi
    cp "$file" "$dest"
    # Migration: remove a stale slash-command copy from an older install.
    if [ -f "$COMMANDS_DIR/$filename" ]; then rm -f "$COMMANDS_DIR/$filename"; echo "    (removed stale /$cmd from commands/)"; fi
    SKILLS_INSTALLED=$((SKILLS_INSTALLED + 1))
  else
    dest="$COMMANDS_DIR/$filename"
    if [ -f "$dest" ]; then echo "  Updating : /$cmd"; else echo "  Installing: /$cmd"; fi
    copy_command_with_version "$file" "$dest"
    INSTALLED=$((INSTALLED + 1))
  fi
done < <(find "$SKILLS_DIR" -name "*.md" -type f -print0 | sort -z)

# Optionally seed the reusable Figma MCP permission allowlist (merge-safe, needs jq).
if [ "$WITH_FIGMA_PERMISSIONS" -eq 1 ]; then
  SETTINGS_PATH="$CLAUDE_DIR/settings.local.json"
  if command -v jq >/dev/null 2>&1; then
    [ -f "$SETTINGS_PATH" ] || echo '{}' > "$SETTINGS_PATH"
    tmp="$(mktemp)"
    jq '.permissions.allow = ((.permissions.allow // []) + [
          "mcp__plugin_figma_figma__get_design_context",
          "mcp__plugin_figma_figma__get_screenshot",
          "mcp__plugin_figma_figma__get_metadata",
          "mcp__plugin_figma_figma__whoami"
        ] | unique)' "$SETTINGS_PATH" > "$tmp" && mv "$tmp" "$SETTINGS_PATH"
    echo ""
    echo "  ✓ Seeded Figma MCP permissions into $SETTINGS_PATH"
  else
    echo ""
    echo "  ! jq not found — skipping permission seeding. Add the Figma MCP allow entries to $SETTINGS_PATH manually."
  fi
fi

# Seed the scope-guard permission hook (on by default; --no-scope-guard opts out).
# A PreToolUse hook auto-allows tool calls that stay inside the project folder and
# leaves anything reaching outside it to the normal approval prompt. Project-local
# installs seed it here; the global branch below seeds it into ~/.claude instead.
if [ -n "$TARGET" ] && [ "$NO_SCOPE_GUARD" -eq 0 ]; then
  echo ""
  echo "  Scope guard (auto-allow inside project, ask outside)"
  GUARD="$SCRIPT_DIR/tools/seed-scope-guard.js"
  if ! command -v node >/dev/null 2>&1; then
    echo "  ! node not found — skipping (the scope-guard hook needs Node.js)."
  elif [ ! -f "$GUARD" ]; then
    echo "  ! Helper not found at $GUARD — skipping."
  else
    node "$(to_native "$GUARD")" "$(to_native "$CLAUDE_DIR")" "$(to_native "$SCRIPT_DIR")"
  fi
elif [ -z "$TARGET" ] && [ "$NO_SCOPE_GUARD" -eq 0 ]; then
  # Global install: seed the scope guard into ~/.claude so the rule
  # (auto-allow inside the open project, ask outside) applies in every project.
  echo ""
  echo "  Scope guard (global: auto-allow inside the open project, ask outside)"
  GUARD="$SCRIPT_DIR/tools/seed-scope-guard.js"
  if ! command -v node >/dev/null 2>&1; then
    echo "  ! node not found — skipping (the scope-guard hook needs Node.js)."
  elif [ ! -f "$GUARD" ]; then
    echo "  ! Helper not found at $GUARD — skipping."
  else
    node "$(to_native "$GUARD")" "$(to_native "$CLAUDE_DIR")" "$(to_native "$SCRIPT_DIR")" --global
  fi
fi

# Seed the runtime permission allowlist (on by default; --no-permissions opts out).
# Merge-safe: only adds curated allow entries (utility Bash, WebFetch, Figma read
# MCP tools) so a pipeline run stops prompting for routine commands. Pairs with
# the scope guard, which still gates anything that escapes the project folder.
if [ "$NO_PERMISSIONS" -eq 0 ]; then
  echo ""
  echo "  Permission allowlist (fewer prompts during runs)"
  PERMS="$SCRIPT_DIR/tools/seed-permissions.js"
  if ! command -v node >/dev/null 2>&1; then
    echo "  ! node not found — skipping (the permission seeder needs Node.js)."
  elif [ ! -f "$PERMS" ]; then
    echo "  ! Helper not found at $PERMS — skipping."
  else
    node "$(to_native "$PERMS")" "$(to_native "$CLAUDE_DIR")"
  fi
fi

# Seed the opt-in debug tracer (project-local installs only). The hook is inert
# unless /twt-site --log arms it, so seeding it is always safe.
if [ -n "$TARGET" ]; then
  echo ""
  echo "  Debug tracer for /twt-site --log (inert until armed)"
  DBG="$SCRIPT_DIR/tools/seed-debug-log.js"
  if ! command -v node >/dev/null 2>&1; then
    echo "  ! node not found — skipping (the debug hook needs Node.js)."
  elif [ ! -f "$DBG" ]; then
    echo "  ! Helper not found at $DBG — skipping."
  else
    node "$(to_native "$DBG")" "$(to_native "$CLAUDE_DIR")" "$(to_native "$SCRIPT_DIR")"
  fi
fi

# Optionally install the external community design skills via the `skills` CLI (needs Node/npx).
if [ "$WITH_EXTERNAL_SKILLS" -eq 1 ]; then
  echo ""
  echo "  External design skills (emil-design-eng, design-taste-frontend)"
  EXT_SOURCES=("emilkowalski/skill" "https://github.com/Leonxlnx/taste-skill")

  if ! command -v npx >/dev/null 2>&1; then
    echo "  ! npx not found (install Node.js) — skipping external skills."
    echo "    Install them manually later with:"
    for src in "${EXT_SOURCES[@]}"; do echo "      npx skills add $src -a claude-code"; done
  elif [ -n "$TARGET" ]; then
    # Project-local: run npx from the target so skills land in <target>/.claude/skills.
    for src in "${EXT_SOURCES[@]}"; do
      echo "  Installing (project): $src"
      ( cd "$TARGET_ROOT" && npx skills add "$src" -a claude-code )
    done
    echo "  ✓ External skills installed into $CLAUDE_DIR/skills (project-local)."
  else
    echo "  ! Global twt install — installing external skills globally (-g)."
    echo "    Note: the skills CLI writes to ~/.agents/skills and symlinks ~/.claude/skills;"
    echo "    if a skill doesn't appear, verify that symlink (known CLI issue)."
    for src in "${EXT_SOURCES[@]}"; do
      echo "  Installing (global): $src"
      npx skills add "$src" -a claude-code -g
    done
  fi
fi

echo ""
echo "  ✓ Done! $INSTALLED command(s) -> $COMMANDS_DIR"
echo "          $SKILLS_INSTALLED sub-skill(s) -> $SKILLS_DEST_DIR (dispatched by orchestrators, not in the / menu)"
echo ""
echo "  Available commands:"
while IFS= read -r -d '' file; do
  filename="$(basename "$file")"
  [[ "$filename" == "README.md" ]] && continue
  cmd="${filename%.md}"
  is_sub_skill "$cmd" && continue
  echo "    /$cmd"
done < <(find "$SKILLS_DIR" -name "*.md" -type f -print0 | sort -z)
echo ""
echo "  Restart Claude Code (CLI or Desktop) to pick up the new commands."
echo ""
