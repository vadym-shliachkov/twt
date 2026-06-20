# twt - Skills Marketplace Installer  [LEGACY FALLBACK — prefer: /plugin marketplace add vadym-shliachkov/twt]
# Works on Windows (PowerShell 5+ and PowerShell Core).
#
# Usage:
#   .\install.ps1                              Install globally (~/.claude/commands) - available in every project
#   .\install.ps1 -Target C:\path\to\project   Install into one project (<project>\.claude\commands)
#   .\install.ps1 -Target . -WithFigmaPermissions   Also seed the Figma MCP permission allowlist
#   .\install.ps1 -Target . -WithExternalSkills      Also install the external design skills via `npx skills`
#   .\install.ps1 -NoScopeGuard                Skip the scope guard (seeded by default, global and -Target)
#   .\install.ps1 -NoPermissions               Skip the runtime permission allowlist (seeded by default)

param(
    [string]$Target,
    [switch]$WithFigmaPermissions,
    [switch]$WithExternalSkills,
    [switch]$NoScopeGuard,
    [switch]$NoPermissions
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
$SkillsDestDir = Join-Path $ClaudeDir "skills"

# Sub-skills (the *-define / *-validate workers + the brand-fetch helper) are dispatched
# only by their orchestrators, never typed directly. They install into .claude/skills/<name>/SKILL.md
# (still invocable via the Skill tool) instead of .claude/commands/, so they don't clutter the
# slash-command list. Everything else (orchestrators + standalone tools) stays a slash command.
function Test-IsSubSkill([string]$BaseName) {
    return ($BaseName -match '-(define|validate)$') -or ($BaseName -eq 'twt-brand-fetch')
}

function Copy-CommandWithVersion([string]$Source, [string]$Destination) {
    $text = Get-Content -Path $Source -Raw -Encoding UTF8
    $versionMatch = [regex]::Match($text, '(?m)^version:\s*(.+?)\s*$')
    if (-not $versionMatch.Success) {
        Copy-Item -Path $Source -Destination $Destination -Force
        return
    }

    $version = $versionMatch.Groups[1].Value.Trim()
    $updated = [regex]::Replace(
        $text,
        '(?m)^description:[^\r\n]*',
        {
            param($m)
            if ($m.Value -match [regex]::Escape("(v$version)")) { return $m.Value }
            return ($m.Value -replace '^(description:\s*)', "`${1}(v$version) ")
        },
        1
    )
    # Write UTF-8 *without* a BOM. Windows PowerShell 5.1's `Set-Content -Encoding UTF8`
    # prepends a BOM, which shifts the opening `---` off byte 0 and breaks Claude Code's
    # frontmatter parser -- the slash menu then falls back to showing the first raw line
    # (`---`) instead of the description. UTF8Encoding($false) = no BOM, on both PS 5.1 and Core.
    [System.IO.File]::WriteAllText($Destination, $updated, (New-Object System.Text.UTF8Encoding($false)))
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

# Find and install all skill files recursively (skip category READMEs).
# Orchestrators + standalone tools -> .claude/commands/<name>.md (slash commands).
# Sub-skills (*-define / *-validate / brand-fetch) -> .claude/skills/<name>/SKILL.md (Skill-tool only).
$Installed = 0
$SkillsInstalled = 0
Get-ChildItem -Path $SkillsDir -Filter "*.md" -Recurse |
    Where-Object { $_.Name -ne "README.md" } |
    Sort-Object Name |
    ForEach-Object {
        $cmd = $_.BaseName

        if (Test-IsSubSkill $cmd) {
            # Sub-skill: install as a Skill (directory + SKILL.md).
            $skillDir = Join-Path $SkillsDestDir $cmd
            if (-not (Test-Path $skillDir)) { New-Item -ItemType Directory -Path $skillDir -Force | Out-Null }
            $dest = Join-Path $skillDir "SKILL.md"
            if (Test-Path $dest) { Write-Host "  Updating  (skill): $cmd" } else { Write-Host "  Installing (skill): $cmd" }
            Copy-Item -Path $_.FullName -Destination $dest -Force
            # Migration: remove a stale slash-command copy from an older install.
            $stale = Join-Path $CommandsDir $_.Name
            if (Test-Path $stale) { Remove-Item -Path $stale -Force; Write-Host "    (removed stale /$cmd from commands\)" }
            $SkillsInstalled++
        } else {
            # Orchestrator / standalone tool: install as a slash command.
            $dest = Join-Path $CommandsDir $_.Name
            if (Test-Path $dest) { Write-Host "  Updating : /$cmd" } else { Write-Host "  Installing: /$cmd" }
            Copy-CommandWithVersion -Source $_.FullName -Destination $dest
            $Installed++
        }
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

# Seed the scope-guard permission hook (on by default; -NoScopeGuard opts out).
# A PreToolUse hook auto-allows tool calls that stay inside the project folder and
# leaves anything reaching outside it to the normal approval prompt. Project-local
# installs seed it here; the global branch below seeds it into ~/.claude instead.
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
} elseif (-not $Target -and -not $NoScopeGuard) {
    # Global install: seed the scope guard into ~/.claude so the rule
    # (auto-allow inside the open project, ask outside) applies in every project.
    $guard = Join-Path $ScriptDir "tools\seed-scope-guard.js"
    Write-Host ""
    Write-Host "  Scope guard (global: auto-allow inside the open project, ask outside)" -ForegroundColor Cyan
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "  ! node not found - skipping (the scope-guard hook needs Node.js)." -ForegroundColor Yellow
    } elseif (-not (Test-Path $guard)) {
        Write-Host "  ! Helper not found at $guard - skipping." -ForegroundColor Yellow
    } else {
        & node $guard $ClaudeDir $ScriptDir --global
    }
}

# Seed the runtime permission allowlist (on by default; -NoPermissions opts out).
# Merge-safe: only adds curated allow entries (utility Bash, WebFetch, Figma read
# MCP tools) so a pipeline run stops prompting for routine commands. Pairs with
# the scope guard, which still gates anything that escapes the project folder.
if (-not $NoPermissions) {
    $perms = Join-Path $ScriptDir "tools\seed-permissions.js"
    Write-Host ""
    Write-Host "  Permission allowlist (fewer prompts during runs)" -ForegroundColor Cyan
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "  ! node not found - skipping (the permission seeder needs Node.js)." -ForegroundColor Yellow
    } elseif (-not (Test-Path $perms)) {
        Write-Host "  ! Helper not found at $perms - skipping." -ForegroundColor Yellow
    } else {
        & node $perms $ClaudeDir
    }
}

# Seed the opt-in debug tracer (project-local installs only). The hook is inert
# unless /twt-site --log arms it, so seeding it is always safe.
if ($Target) {
    $dbg = Join-Path $ScriptDir "tools\seed-debug-log.js"
    Write-Host ""
    Write-Host "  Debug tracer for /twt-site --log (inert until armed)" -ForegroundColor Cyan
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
Write-Host "  Done! $Installed command(s) -> $CommandsDir" -ForegroundColor Green
Write-Host "        $SkillsInstalled sub-skill(s) -> $SkillsDestDir (dispatched by orchestrators, not in the / menu)" -ForegroundColor Green
Write-Host ""
Write-Host "  Available commands:"
Get-ChildItem -Path $SkillsDir -Filter "*.md" -Recurse |
    Where-Object { $_.Name -ne "README.md" -and -not (Test-IsSubSkill $_.BaseName) } |
    Sort-Object Name |
    ForEach-Object { Write-Host "    /$($_.BaseName)" }
Write-Host ""
Write-Host "  Restart Claude Code (CLI or Desktop) to pick up the new commands."
Write-Host ""
