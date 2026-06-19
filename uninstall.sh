#!/usr/bin/env bash
# twt — Skills Marketplace Uninstaller
# Usage: bash uninstall.sh

set -e

CLAUDE_DIR="$HOME/.claude"
COMMANDS_DIR="$CLAUDE_DIR/commands"
SKILLS_DEST_DIR="$CLAUDE_DIR/skills"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$SCRIPT_DIR/skills"

echo ""
echo "  twt Skills Marketplace — Uninstaller"
echo "  ─────────────────────────────────────"
echo ""

REMOVED=0
while IFS= read -r -d '' file; do
  filename="$(basename "$file")"
  [[ "$filename" == "README.md" ]] && continue

  cmd="${filename%.md}"
  # Remove wherever it might live (handles installs from before/after the skills/ split).
  found=0
  if [ -f "$COMMANDS_DIR/$filename" ]; then rm -f "$COMMANDS_DIR/$filename"; found=1; fi
  if [ -d "$SKILLS_DEST_DIR/$cmd" ]; then rm -rf "$SKILLS_DEST_DIR/$cmd"; found=1; fi

  if [ "$found" -eq 1 ]; then
    echo "  Removed: $cmd"
    REMOVED=$((REMOVED + 1))
  else
    echo "  Skipped (not found): $cmd"
  fi
done < <(find "$SKILLS_DIR" -name "*.md" -type f -print0 | sort -z)

echo ""
echo "  ✓ Done. $REMOVED command(s) removed."
echo ""
