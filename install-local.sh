#!/usr/bin/env bash
# twt - Skills Marketplace Installer (LOCAL pack)
# Installs all /twt-* commands into a single project's .claude/commands folder,
# so they are available only when working inside that project.
#
# Usage:
#   bash install-local.sh /path/to/project
#   bash install-local.sh .                        (current folder)
#   bash install-local.sh . --no-figma-permissions (skip seeding Figma MCP permissions)
#
# For a machine-wide install (every project), use bash install.sh instead.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="$SCRIPT_DIR/install.sh"

PATH_ARG=""
WITH_FIGMA="--with-figma-permissions"
while [ $# -gt 0 ]; do
  case "$1" in
    --no-figma-permissions) WITH_FIGMA=""; shift ;;
    *) PATH_ARG="$1"; shift ;;
  esac
done

if [ -z "$PATH_ARG" ]; then
  echo "  ERROR: missing project path."
  echo "  Usage: bash install-local.sh /path/to/project"
  exit 1
fi
if [ ! -f "$ENGINE" ]; then
  echo "  ERROR: install.sh not found next to install-local.sh"
  exit 1
fi

bash "$ENGINE" --target "$PATH_ARG" $WITH_FIGMA
