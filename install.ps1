# twt - Skills Marketplace Installer
# Works on Windows (PowerShell 5+ and PowerShell Core).
#
# Usage:
#   .\install.ps1                              Install globally (~/.claude/commands) - available in every project
#   .\install.ps1 -Target C:\path\to\project   Install into one project (<project>\.claude\commands)
#   .\install.ps1 -Target . -WithFigmaPermissions   Also seed the Figma MCP permission allowlist
#   .\install.ps1 -Target . -WithExternalSkills      Also install the external design skills via `npx skills`
#   .\install.ps1 -Target . -NoScopeGuard            Skip the project-scope permission guard (on by default for -Target)

param(
    [string]$Target,
    [switch]$WithFigmaPermissions,
    [switch]$WithExternalSkills,
    [switch]$NoScopeGuard
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillsDir = Join-Path $ScriptDir "skills"

# Resolve install location: project-local when -Target is given, else global.
if ($Target) {
    if (-not (Test-Path $Target)) {
        Write-Host "  Creating target folder $Target ..."
        New-Item -ItemType Directory -Path $Target -Force | Out-Null
    }
    $TargetRoot  = (Resolve-Path $Target).Path
    $ClaudeDir   = Join-Path $TargetRoot ".claude"
    $CommandsDir = Join-Path $ClaudeDir "commands"
    $Scope = "project ($TargetRoot)"
} else {
    $ClaudeDir   = Join-Path $env:USERPROFILE ".claude"
    $CommandsDir = Join-Path $ClaudeDir "commands"
    $Scope = "global ($env:USERPROFILE)"
}

Write-Host ""
Write-Host "  twt Skills Marketplace - Installer" -ForegroundColor Cyan
Write-Host "  ----------------------------------"
Write-Host "  Scope: $Scope"
Write-Host ""

# Verify skills directory exists
if (-not (Test-Path $SkillsDir)) {
    Write-Host "  ERROR: skills\ folder not found next to install.ps1" -ForegroundColor Red
    Write-Host "  Make sure you are running this from the twt repo root."
    exit 1
}

# Create the Claude commands directory if it doesn't exist
if (-not (Test-Path $CommandsDir)) {
    Write-Host "  Creating $CommandsDir ..."
    New-Item -ItemType Directory -Path $CommandsDir -Force | Out-Null
}

# Find and install all skill files recursively (skip category READMEs)
$Installed = 0
Get-ChildItem -Path $SkillsDir -Filter "*.md" -Recurse |
    Where-Object { $_.Name -ne "README.md" } |
    Sort-Object Name |
    ForEach-Object {
        $dest = Join-Path $CommandsDir $_.Name
        $cmd  = $_.BaseName

        if (Test-Path $dest) {
            Write-Host "  Updating : /$cmd"
        } else {
            Write-Host "  Installing: /$cmd"
        }

        Copy-Item -Path $_.FullName -Destination $dest -Force
        $Installed++
    }

# Optionally seed the reusable Figma MCP permission allowlist (merge-safe).
if ($WithFigmaPermissions) {
    $figmaPerms = @(
        "mcp__plugin_figma_figma__get_design_context",
        "mcp__plugin_figma_figma__get_screenshot",
        "mcp__plugin_figma_figma__get_metadata",
        "mcp__plugin_figma_figma__whoami"
    )
    $settingsPath = Join-Path $ClaudeDir "settings.local.json"

    if (Test-Path $settingsPath) {
        $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    } else {
        $settings = [PSCustomObject]@{}
    }
    if (-not $settings.PSObject.Properties['permissions']) {
        $settings | Add-Member -NotePropertyName permissions -NotePropertyValue ([PSCustomObject]@{})
    }
    if (-not $settings.permissions.PSObject.Properties['allow']) {
        $settings.permissions | Add-Member -NotePropertyName allow -NotePropertyValue @()
    }
    $existing = @($settings.permissions.allow)
    $added = 0
    foreach ($p in $figmaPerms) {
        if ($existing -notcontains $p) { $existing += $p; $added++ }
    }
    $settings.permissions.allow = $existing
    $settings | ConvertTo-Json -Depth 10 | Set-Content -Path $settingsPath -Encoding UTF8
    Write-Host ""
    Write-Host "  Seeded $added Figma MCP permission(s) into $settingsPath" -ForegroundColor Green
}

# Seed the project-scope permission guard (project-local installs only, on by default).
# A PreToolUse hook auto-allows tool calls that stay inside the project folder and
# leaves anything reaching outside it to the normal approval prompt.
if ($Target -and -not $NoScopeGuard) {
    $guard = Join-Path $ScriptDir "tools\seed-scope-guard.js"
    Write-Host ""
    Write-Host "  Scope guard (auto-allow inside project, ask outside)" -ForegroundColor Cyan
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "  ! node not found - skipping (the scope-guard hook needs Node.js)." -ForegroundColor Yellow
    } elseif (-not (Test-Path $guard)) {
        Write-Host "  ! Helper not found at $guard - skipping." -ForegroundColor Yellow
    } else {
        & node $guard $ClaudeDir $ScriptDir
    }
} elseif (-not $Target) {
    Write-Host ""
    Write-Host "  Note: the scope guard is project-scoped. Add it to a project with:" -ForegroundColor DarkGray
    Write-Host "        .\install.ps1 -Target C:\path\to\project" -ForegroundColor DarkGray
}

# Seed the opt-in debug tracer (project-local installs only). The hook is inert
# unless /twt-roast-full --log arms it, so seeding it is always safe.
if ($Target) {
    $dbg = Join-Path $ScriptDir "tools\seed-debug-log.js"
    Write-Host ""
    Write-Host "  Debug tracer for /twt-roast-full --log (inert until armed)" -ForegroundColor Cyan
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "  ! node not found - skipping (the debug hook needs Node.js)." -ForegroundColor Yellow
    } elseif (-not (Test-Path $dbg)) {
        Write-Host "  ! Helper not found at $dbg - skipping." -ForegroundColor Yellow
    } else {
        & node $dbg $ClaudeDir $ScriptDir
    }
}

# Optionally install the external community design skills via the `skills` CLI (needs Node/npx).
if ($WithExternalSkills) {
    Write-Host ""
    Write-Host "  External design skills (emil-design-eng, design-taste-frontend)" -ForegroundColor Cyan
    $extSources = @("emilkowalski/skill", "https://github.com/Leonxlnx/taste-skill")

    if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
        Write-Host "  ! npx not found (install Node.js) - skipping external skills." -ForegroundColor Yellow
        Write-Host "    Install them manually later with:"
        foreach ($src in $extSources) { Write-Host "      npx skills add $src -a claude-code" }
    } elseif ($Target) {
        # Project-local: run npx from the target so skills land in <target>\.claude\skills.
        Push-Location $TargetRoot
        try {
            foreach ($src in $extSources) {
                Write-Host "  Installing (project): $src"
                & npx skills add $src -a claude-code
            }
        } finally {
            Pop-Location
        }
        Write-Host "  External skills installed into $(Join-Path $ClaudeDir 'skills') (project-local)." -ForegroundColor Green
    } else {
        Write-Host "  ! Global twt install - installing external skills globally (-g)." -ForegroundColor Yellow
        Write-Host "    Note: the skills CLI writes to ~/.agents/skills and symlinks ~/.claude/skills;"
        Write-Host "    if a skill doesn't appear, verify that symlink (known CLI issue)."
        foreach ($src in $extSources) {
            Write-Host "  Installing (global): $src"
            & npx skills add $src -a claude-code -g
        }
    }
}

Write-Host ""
Write-Host "  Done! $Installed command(s) installed to $CommandsDir" -ForegroundColor Green
Write-Host ""
Write-Host "  Available commands:"
Get-ChildItem -Path $SkillsDir -Filter "*.md" -Recurse |
    Where-Object { $_.Name -ne "README.md" } |
    Sort-Object Name |
    ForEach-Object { Write-Host "    /$($_.BaseName)" }
Write-Host ""
Write-Host "  Restart Claude Code (CLI or Desktop) to pick up the new commands."
Write-Host ""
