# Usage: pwsh tools/check-skill.ps1 commands/twt-site.md
#        pwsh tools/check-skill.ps1 skills/twt-brand-define/SKILL.md
# ASCII-only on purpose: this runs under Windows PowerShell 5.1, which misreads
# non-ASCII bytes in a UTF-8 (no BOM) file. Do not add em dashes / section signs.
param([Parameter(Mandatory)][string]$Path)
$ErrorActionPreference = "Stop"

$required = @('name','category','description','version','accepts_arguments','inputs','dependencies','reads','writes')
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

# Setup-gate presence (setup-gate convention): every user-facing command must
# open with the "Step 0 ... permission allowlist" gate. Excluded: the meta
# skills (twt-setup, twt-marketplace-docs, twt-status) and dispatched
# sub-variants (twt-content-fetch-*, twt-export-*), which run under a gated
# parent. Sub-skills in skills/ never carry the gate. The gate BODY is synced
# by gen-docs.mjs from templates/blocks/setup-gate.md; this only checks presence.
$isCommand = (Split-Path $resolvedPath -Leaf) -ine 'SKILL.md'
$gateExempt = @('twt-setup','twt-marketplace-docs','twt-status','twt-eval-smoke')
$gateExemptPrefix = @('twt-content-fetch-','twt-export-')
if ($isCommand) {
    $exempt = ($gateExempt -contains $expectedName) -or
              (($gateExemptPrefix | Where-Object { $expectedName.StartsWith($_) }).Count -gt 0)
    if (-not $exempt -and $text -notmatch '(?im)^## Step 0.*permission allowlist') {
        Fail "MISSING SETUP GATE in ${Path}: user-facing commands must open with the Step 0 permission-allowlist gate (see SKILL_TEMPLATE.md); if this command is a meta skill or dispatched sub-variant, add it to the exempt list in tools/check-skill.ps1"
    }
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
if (Test-Path $repoRoot) {
    $allFiles = Get-NativeSkillFiles $repoRoot

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
        Fail "DANGLING DEPENDENCY in ${Path}: $($dangling -join ', ') (not a skill in $repoRoot and not a known external: $($KnownExternalDeps -join ', '))"
    }
}

# CONVENTIONS cross-reference check: every section-sign / "rule N" citation in the
# skill body must resolve to a real section in CONVENTIONS.md (catches stale refs
# like the old phantom "13.1"). The section sign (U+00A7) is built at runtime via
# [char]0x00A7 so this script's source stays pure ASCII (Windows PowerShell 5.1
# mangles non-ASCII bytes in a no-BOM file).
if ($repoRoot) {
    if ([string]::IsNullOrEmpty($repoRoot)) { $repoRoot = '.' }
    $convPath = Join-Path $repoRoot 'CONVENTIONS.md'
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
