# twt - Skills Marketplace Installer (LOCAL pack)
# Installs all /twt-* commands into a single project's .claude\commands folder,
# so they are available only when working inside that project.
#
# Usage:
#   .\install-local.ps1 C:\path\to\project
#   .\install-local.ps1 .                       (current folder)
#   .\install-local.ps1 . -NoFigmaPermissions   (skip seeding Figma MCP permissions)
#
# For a machine-wide install (every project), use .\install.ps1 instead.

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path,
    [switch]$NoFigmaPermissions
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Engine    = Join-Path $ScriptDir "install.ps1"

if (-not (Test-Path $Engine)) {
    Write-Host "  ERROR: install.ps1 not found next to install-local.ps1" -ForegroundColor Red
    exit 1
}

if ($NoFigmaPermissions) {
    & $Engine -Target $Path
} else {
    & $Engine -Target $Path -WithFigmaPermissions
}
