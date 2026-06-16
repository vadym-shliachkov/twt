# twt — Skills Marketplace Uninstaller
# Usage: .\uninstall.ps1

$ErrorActionPreference = "Stop"

$CommandsDir = Join-Path $env:USERPROFILE ".claude\commands"
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillsDir   = Join-Path $ScriptDir "skills"

Write-Host ""
Write-Host "  twt Skills Marketplace — Uninstaller" -ForegroundColor Cyan
Write-Host "  ─────────────────────────────────────"
Write-Host ""

$Removed = 0
Get-ChildItem -Path $SkillsDir -Filter "*.md" -Recurse |
    Where-Object { $_.Name -ne "README.md" } |
    Sort-Object Name |
    ForEach-Object {
        $dest = Join-Path $CommandsDir $_.Name
        $cmd  = $_.BaseName

        if (Test-Path $dest) {
            Remove-Item -Path $dest -Force
            Write-Host "  Removed: /$cmd"
            $Removed++
        } else {
            Write-Host "  Skipped (not found): /$cmd"
        }
    }

Write-Host ""
Write-Host "  ✓ Done. $Removed command(s) removed." -ForegroundColor Green
Write-Host ""
