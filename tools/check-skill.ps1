# Usage: pwsh tools/check-skill.ps1 skills/brand/twt-brand.md
# ASCII-only on purpose: this runs under Windows PowerShell 5.1, which misreads
# non-ASCII bytes in a UTF-8 (no BOM) file. Do not add em dashes / section signs.
param([Parameter(Mandatory)][string]$Path)
$ErrorActionPreference = "Stop"

$required = @('name','category','description','version','accepts_arguments','inputs','dependencies','reads','writes')
# Non-skill tools that are allowed to appear in dependencies.hard / dependencies.soft.
$KnownExternalDeps = @('figma-mcp','WebFetch')

function Fail($msg) { Write-Error $msg; exit 1 }

if (-not (Test-Path $Path)) { Fail "MISSING FILE: $Path" }
# Read as UTF-8 so the section-sign (U+00A7) in CONVENTIONS citations is intact.
$text = Get-Content $Path -Raw -Encoding UTF8
if ($text -notmatch "^---") { Fail "NO FRONTMATTER: $Path" }
$fm = ($text -split "(?m)^---\s*$")[1]
$fmLines = $fm -split "`r?`n"

# Required fields present
$missing = $required | Where-Object { $fm -notmatch "(?m)^\s*$($_):" }
if ($missing) { Fail "MISSING FIELDS in ${Path}: $($missing -join ', ')" }

# name == filename
$expectedName = [System.IO.Path]::GetFileNameWithoutExtension($Path)
if ($fm -notmatch "(?m)^\s*name:\s*$([regex]::Escape($expectedName))\s*$") {
    Fail "NAME MISMATCH in ${Path}: frontmatter name must equal '$expectedName'"
}

# category == parent folder (CONVENTIONS section 1)
$folder = Split-Path (Split-Path $Path -Parent) -Leaf
if ($fm -notmatch "(?m)^\s*category:\s*$([regex]::Escape($folder))\s*$") {
    Fail "CATEGORY MISMATCH in ${Path}: frontmatter category must equal parent folder '$folder'"
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

# Validator write-scoping (CONVENTIONS section 11):
# a *-validate skill may write ONLY its sibling validation-report.md.
if ($expectedName -match '-validate$') {
    $writes = Get-YamlList -Lines $fmLines -Key 'writes' -KeyIndent 0
    $bad = $writes | Where-Object { $_ -notmatch 'validation-report\.md$' }
    if ($bad) {
        Fail "VALIDATOR WRITE-SCOPE VIOLATION in ${Path}: a *-validate skill may write only its sibling validation-report.md; offending: $($bad -join ', ')"
    }
}

# Cross-file checks (need the whole skills tree)
$skillsRoot = Split-Path (Split-Path $Path -Parent) -Parent
if (Test-Path $skillsRoot) {
    $allFiles = Get-ChildItem -Path $skillsRoot -Recurse -Filter '*.md' | Where-Object { $_.Name -ne 'README.md' }

    # Global filename uniqueness: the installer copies every skill FLAT into one
    # commands dir, so two same-named files in different categories would clobber.
    $dupes = @($allFiles | Where-Object { $_.Name -eq "$expectedName.md" })
    if ($dupes.Count -gt 1) {
        $where = ($dupes | ForEach-Object { $_.FullName }) -join '; '
        Fail "DUPLICATE SKILL FILENAME '$expectedName.md' ($($dupes.Count) copies): $where (installer copies flat, filenames must be globally unique)"
    }

    # Dangling dependencies: every hard/soft dep must resolve to a real skill
    # file or a known external tool.
    $allNames = $allFiles | ForEach-Object { $_.BaseName }
    $deps = @()
    $deps += Get-YamlList -Lines $fmLines -Key 'hard' -KeyIndent 2
    $deps += Get-YamlList -Lines $fmLines -Key 'soft' -KeyIndent 2
    $dangling = $deps | Where-Object { $_ -and ($allNames -notcontains $_) -and ($KnownExternalDeps -notcontains $_) }
    if ($dangling) {
        Fail "DANGLING DEPENDENCY in ${Path}: $($dangling -join ', ') (not a skill in $skillsRoot and not a known external: $($KnownExternalDeps -join ', '))"
    }
}

# CONVENTIONS cross-reference check: every section-sign / "rule N" citation in the
# skill body must resolve to a real section in CONVENTIONS.md (catches stale refs
# like the old phantom "13.1"). The section sign (U+00A7) is built at runtime via
# [char]0x00A7 so this script's source stays pure ASCII (Windows PowerShell 5.1
# mangles non-ASCII bytes in a no-BOM file).
if ($skillsRoot) {
    $repoRoot = Split-Path $skillsRoot -Parent
    if ([string]::IsNullOrEmpty($repoRoot)) { $repoRoot = '.' }   # relative 'skills' -> repo root is cwd
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
