# twt — Skills Marketplace Uninstaller
# Usage: .\uninstall.ps1

$ErrorActionPreference = "Stop"

$ClaudeDir     = Join-Path $env:USERPROFILE ".claude"
$CommandsDir   = Join-Path $ClaudeDir "commands"
$SkillsDestDir = Join-Path $ClaudeDir "skills"
$ScriptDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillsDir     = Join-Path $ScriptDir "skills"

function Test-IsSubSkill([string]$BaseName) {
    return ($BaseName -match '-(define|validate)$') -or ($BaseName -eq 'twt-brand-fetch')
}

Write-Host ""
Write-Host "  twt Skills Marketplace — Uninstaller" -ForegroundColor Cyan
Write-Host "  ─────────────────────────────────────"
Write-Host ""

$Removed = 0
Get-ChildItem -Path $SkillsDir -Filter "*.md" -Recurse |
    Where-Object { $_.Name -ne "README.md" } |
    Sort-Object Name |
    ForEach-Object {
        $cmd = $_.BaseName
        # Remove wherever it might live (handles installs from before/after the skills/ split).
        $cmdDest   = Join-Path $CommandsDir $_.Name
        $skillDest = Join-Path $SkillsDestDir $cmd
        $found = $false
        if (Test-Path $cmdDest)   { Remove-Item -Path $cmdDest -Force; $found = $true }
        if (Test-Path $skillDest) { Remove-Item -Path $skillDest -Recurse -Force; $found = $true }
        if ($found) {
            Write-Host "  Removed: $cmd"
            $Removed++
        } else {
            Write-Host "  Skipped (not found): $cmd"
        }
    }

Write-Host ""
Write-Host "  ✓ Done. $Removed command(s) removed." -ForegroundColor Green
Write-Host ""
