# Usage: pwsh tools/check-skill.ps1 skills/twt-site/SKILL.md
#        pwsh tools/check-skill.ps1 skills/twt-brand-define/SKILL.md
# ASCII-only on purpose: this runs under Windows PowerShell 5.1, which misreads
# non-ASCII bytes in a UTF-8 (no BOM) file. Do not add em dashes / section signs.
param([Parameter(Mandatory)][string]$Path)
$ErrorActionPreference = "Stop"

$required = @('name','surface','category','description','version','accepts_arguments','inputs','dependencies','reads','writes')
# Non-skill tools that are allowed to appear in dependencies.hard / dependencies.soft.
$KnownExternalDeps = @('figma-mcp','WebFetch')

function Fail($msg) { Write-Error $msg; exit 1 }

function Get-SkillNameFromPath {
    param([string]$SkillPath)
    $leaf = Split-Path $SkillPath -Leaf
    if ($leaf -ieq 'SKILL.md') {
        return Split-Path (Split-Path $SkillPath -Parent) -Leaf
    }
    return [System.IO.Path]::GetFileNameWithoutExtension($SkillPath)
}

function Get-RepoRootFromPath {
    param([string]$SkillPath)
    $leaf = Split-Path $SkillPath -Leaf
    $parent = Split-Path $SkillPath -Parent
    if ($leaf -ieq 'SKILL.md') {
        $skillsDir = Split-Path $parent -Parent
        return Split-Path $skillsDir -Parent
    }
    return Split-Path $parent -Parent
}

# The marketplace root is the repo: the nearest ancestor carrying
# .claude-plugin/marketplace.json. It differs from $repoRoot (the owning PLUGIN's
# root) as soon as a plugin is split out under ./plugins/<name>. Cross-file
# checks — name uniqueness, dependency resolution, CONVENTIONS citations — are
# marketplace-wide: a skill may legitimately depend on one shipped by a sibling
# plugin, and CONVENTIONS.md lives once at the repo root.
function Get-MarketplaceRootFromPath {
    param([string]$StartDir)
    $dir = $StartDir
    while ($dir) {
        if (Test-Path (Join-Path $dir '.claude-plugin/marketplace.json')) { return $dir }
        $parent = Split-Path $dir -Parent
        if ($parent -eq $dir) { break }
        $dir = $parent
    }
    return $StartDir
}

function Get-AllPluginSkillFiles {
    param([string]$MarketplaceRoot)
    $manifest = Join-Path $MarketplaceRoot '.claude-plugin/marketplace.json'
    $roots = @()
    if (Test-Path $manifest) {
        try {
            $json = Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($p in $json.plugins) {
                $src = if ($p.source) { $p.source } else { './' }
                $roots += (Join-Path $MarketplaceRoot $src)
            }
        } catch { $roots = @($MarketplaceRoot) }
    }
    if (-not $roots) { $roots = @($MarketplaceRoot) }
    $files = @()
    foreach ($r in $roots) { $files += Get-NativeSkillFiles $r }
    return $files
}

function Get-NativeSkillFiles {
    param([string]$RepoRoot)
    $files = @()
    $commandsDir = Join-Path $RepoRoot 'commands'
    $skillsDir = Join-Path $RepoRoot 'skills'
    if (Test-Path $commandsDir) {
        $files += Get-ChildItem -Path $commandsDir -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' }
    }
    if (Test-Path $skillsDir) {
        $files += Get-ChildItem -Path $skillsDir -Recurse -Filter 'SKILL.md' -File
    }
    return $files
}

if (-not (Test-Path $Path)) { Fail "MISSING FILE: $Path" }
$resolvedPath = (Resolve-Path $Path).Path
$expectedName = Get-SkillNameFromPath $resolvedPath
$repoRoot = Get-RepoRootFromPath $resolvedPath
$marketplaceRoot = Get-MarketplaceRootFromPath $repoRoot

# Read as UTF-8 so the section-sign (U+00A7) in CONVENTIONS citations is intact.
$text = Get-Content $Path -Raw -Encoding UTF8
if ($text -notmatch "^---") { Fail "NO FRONTMATTER: $Path" }
$fm = ($text -split "(?m)^---\s*$")[1]
$fmLines = $fm -split "`r?`n"

# Required fields present
$missing = $required | Where-Object { $fm -notmatch "(?m)^\s*$($_):" }
if ($missing) { Fail "MISSING FIELDS in ${Path}: $($missing -join ', ')" }

# name == command filename or sub-skill directory
if ($fm -notmatch "(?m)^\s*name:\s*$([regex]::Escape($expectedName))\s*$") {
    Fail "NAME MISMATCH in ${Path}: frontmatter name must equal '$expectedName'"
}

# Intent block present
if ($text -notmatch "##\s*Intent") { Fail "NO INTENT BLOCK: $Path" }

# Extract a YAML block-sequence list declared under <Key> at the given indent.
# Returns @() for an inline empty list (key: []) or a key with no items.
function Get-YamlList {
    param([string[]]$Lines, [string]$Key, [int]$KeyIndent)
    $pat = '^' + (' ' * $KeyIndent) + [regex]::Escape($Key) + ':\s*(.*)$'
    $items = @(); $cap = $false
    foreach ($ln in $Lines) {
        if (-not $cap) {
            if ($ln -match $pat) {
                if ($Matches[1].Trim() -match '^\[\s*\]$') { return @() }
                $cap = $true
            }
            continue
        }
        if ($ln.Trim() -eq '') { continue }
        $ind = ($ln -replace '\S.*$','').Length
        if ($ind -le $KeyIndent) { break }
        if ($ln -match '^\s*-\s*(.+?)\s*$') { $items += $Matches[1].Trim() }
        else { break }
    }
    return $items
}

# Setup-gate presence (setup-gate convention): the permission-allowlist gate
# lives ONLY on the pipeline entry points listed below — the commands a run
# actually starts from. Every other command is reached by dispatch from one of
# them (or expects the user to have run /twt-setup once for the project), so it
# carries no gate. The gate BODY is synced by gen-docs.mjs from
# templates/blocks/setup-gate.md; this only checks presence.
#
# The Bash-call-shape rule is separate and applies to EVERY user-facing command,
# gated or not: it is what keeps calls matchable against a seeded allowlist, so
# dropping the gate must not drop it. Excluded from both: the meta skills and
# the dispatched sub-variants (twt-content-fetch-*, twt-export-*). Sub-skills in
# skills/ carry neither.
# Which skills are user-facing is declared, not inferred from the path. This
# used to read `leaf -ine 'SKILL.md'` back when entry points lived in a flat
# commands/ dir; every skill is a SKILL.md now, so that test would be constant
# false and would quietly disable both rules below for the whole repo. If the
# field is missing or unrecognised, fail rather than default - a silent skip is
# exactly the failure this replaced.
if ($fm -match '(?m)^surface:\s*(\S+)\s*$') { $surface = $Matches[1] } else { $surface = '' }
if ($surface -notin @('command','internal')) {
    Fail "BAD SURFACE in ${Path}: surface must be 'command' or 'internal' (got '$surface'); it decides whether the setup-gate and Bash-call-shape rules apply"
}
$isCommand = $surface -eq 'command'
$gateRequired = @('twt-site','twt-site-dev','twt-pre-design','twt-design','twt-develop','twt-qa')
$blockExempt = @('twt-setup','twt-marketplace-docs','twt-status','twt-eval-smoke')
$blockExemptPrefix = @('twt-content-fetch-','twt-export-')
if ($isCommand) {
    $hasGate = $text -match '(?im)^## Step 0.*permission allowlist'
    if (($gateRequired -contains $expectedName) -and -not $hasGate) {
        Fail "MISSING SETUP GATE in ${Path}: pipeline entry points must open with the Step 0 permission-allowlist gate (see SKILL_TEMPLATE.md); the entry-point list is gateRequired in tools/check-skill.ps1"
    }
    if (-not ($gateRequired -contains $expectedName) -and $hasGate) {
        Fail "UNEXPECTED SETUP GATE in ${Path}: only the pipeline entry points carry the Step 0 permission-allowlist gate; dispatched and standalone commands rely on the entry point (or a one-time /twt-setup). Remove the gate, or add this command to gateRequired in tools/check-skill.ps1"
    }
    $exempt = ($blockExempt -contains $expectedName) -or
              (($blockExemptPrefix | Where-Object { $expectedName.StartsWith($_) }).Count -gt 0)
    if (-not $exempt -and $text -notmatch '(?im)^## Bash call shape') {
        Fail "MISSING BASH-SHAPE BLOCK in ${Path}: every user-facing command must carry the Bash call shape block (synced from templates/blocks/bash-shape.md) so its Bash calls stay matchable against the seeded allowlist; if this command is a meta skill or dispatched sub-variant, add it to blockExempt in tools/check-skill.ps1"
    }
}

# Figma-read discipline: any skill that drives a Figma READ tool must carry the
# "## Reading Figma" block (synced from templates/blocks/figma-read.md). The rule
# is keyed off the tool names themselves rather than a maintained list, so a new
# Figma reader cannot be added without the discipline coming with it. Skipping it
# is what produced three different Figma-reading behaviours across this repo.
# Applies to commands and sub-skills alike - either can drive the MCP directly.
$figmaReadTools = 'get_design_context|get_variable_defs|get_screenshot|get_metadata'
if (($text -match $figmaReadTools) -and ($text -notmatch '(?im)^## Reading Figma')) {
    Fail "MISSING FIGMA-READ BLOCK in ${Path}: this skill calls a Figma read tool, so it must carry the '## Reading Figma' block (synced from templates/blocks/figma-read.md by /twt-marketplace-docs). Add the heading and regenerate."
}

# Runtime self-containment (CONVENTIONS section 14): skills must not reference
# a templates/ path at runtime; formats are carried inline. Exception: the
# export skills (twt-export*) genuinely load templates/themes + export styles,
# and twt-marketplace-docs is author-time-only meta.
$tplExemptPrefix = @('twt-export','twt-marketplace-docs')
$tplExempt = (($tplExemptPrefix | Where-Object { $expectedName.StartsWith($_) }).Count -gt 0)
if (-not $tplExempt) {
    $body = ($text -split "(?m)^---\s*$", 3)[2]
    if ($body -cmatch '(?m)templates/') {
        Fail "TEMPLATES PATH AT RUNTIME in ${Path}: skills are self-contained (CONVENTIONS section 14) and must inline formats instead of referencing templates/..."
    }
}

# Validator write-scoping (CONVENTIONS section 11):
# a *-validate skill may write ONLY its sibling validation-report.md.
if ($expectedName -match '-validate$') {
    $writes = Get-YamlList -Lines $fmLines -Key 'writes' -KeyIndent 0
    $bad = $writes | Where-Object { $_ -notmatch 'validation-report\.md$' }
    if ($bad) {
        Fail "VALIDATOR WRITE-SCOPE VIOLATION in ${Path}: a *-validate skill may write only its sibling validation-report.md; offending: $($bad -join ', ')"
    }
}

# Cross-file checks (need the whole native plugin skill tree)
if (Test-Path $marketplaceRoot) {
    $allFiles = Get-AllPluginSkillFiles $marketplaceRoot

    # Global skill-name uniqueness across commands/*.md and skills/*/SKILL.md.
    $dupes = @($allFiles | Where-Object { (Get-SkillNameFromPath $_.FullName) -eq $expectedName })
    if ($dupes.Count -gt 1) {
        $where = ($dupes | ForEach-Object { $_.FullName }) -join '; '
        Fail "DUPLICATE SKILL NAME '$expectedName' ($($dupes.Count) copies): $where"
    }

    # Dangling dependencies: every hard/soft dep must resolve to a real skill
    # file or a known external tool.
    $allNames = $allFiles | ForEach-Object { Get-SkillNameFromPath $_.FullName }
    $deps = @()
    $deps += Get-YamlList -Lines $fmLines -Key 'hard' -KeyIndent 2
    $deps += Get-YamlList -Lines $fmLines -Key 'soft' -KeyIndent 2
    $dangling = $deps | Where-Object { $_ -and ($allNames -notcontains $_) -and ($KnownExternalDeps -notcontains $_) }
    if ($dangling) {
        Fail "DANGLING DEPENDENCY in ${Path}: $($dangling -join ', ') (not a skill in any plugin under $marketplaceRoot and not a known external: $($KnownExternalDeps -join ', '))"
    }
}

# CONVENTIONS cross-reference check: every section-sign / "rule N" citation in the
# skill body must resolve to a real section in CONVENTIONS.md (catches stale refs
# like the old phantom "13.1"). The section sign (U+00A7) is built at runtime via
# [char]0x00A7 so this script's source stays pure ASCII (Windows PowerShell 5.1
# mangles non-ASCII bytes in a no-BOM file).
if ($marketplaceRoot) {
    if ([string]::IsNullOrEmpty($marketplaceRoot)) { $marketplaceRoot = '.' }
    $convPath = Join-Path $marketplaceRoot 'CONVENTIONS.md'
    if (Test-Path $convPath) {
        $sectionSign = [char]0x00A7
        $conv = Get-Content $convPath -Raw -Encoding UTF8
        $secNums = [regex]::Matches($conv, '(?m)^##\s+(\d+)\.') | ForEach-Object { [int]$_.Groups[1].Value }
        if ($secNums.Count -gt 0) {
            $maxSec = ($secNums | Measure-Object -Maximum).Maximum
            $cites = @()
            $cites += [regex]::Matches($text, "$sectionSign\s*(\d+)") | ForEach-Object { [int]$_.Groups[1].Value }
            $cites += [regex]::Matches($text, '(?i)\brule\s+(\d+)\b') | ForEach-Object { [int]$_.Groups[1].Value }
            $badCites = $cites | Where-Object { $_ -lt 1 -or $_ -gt $maxSec } | Sort-Object -Unique
            if ($badCites) {
                Fail "BAD CONVENTIONS REFERENCE in ${Path}: cites section(s) $($badCites -join ', ') but CONVENTIONS.md only has 1..$maxSec"
            }
        }
    }
}

Write-Host "OK: $Path" -ForegroundColor Green
