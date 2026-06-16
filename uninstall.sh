#!/usr/bin/env bash
# twt — Skills Marketplace Uninstaller
# Usage: bash uninstall.sh

set -e

COMMANDS_DIR="$HOME/.claude/commands"
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

  dest="$COMMANDS_DIR/$filename"
  cmd="${filename%.md}"

  if [ -f "$dest" ]; then
    rm "$dest"
    echo "  Removed: /$cmd"
    REMOVED=$((REMOVED + 1))
  else
    echo "  Skipped (not found): /$cmd"
  fi
done < <(find "$SKILLS_DIR" -name "*.md" -type f -print0 | sort -z)

echo ""
echo "  ✓ Done. $REMOVED command(s) removed."
echo ""
