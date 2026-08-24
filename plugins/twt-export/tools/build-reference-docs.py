#!/usr/bin/env python3
"""Build a reference.docx and reference.pptx for pandoc --reference-doc.

Defaults to the doc-hub-light house tokens; pass --out-dir plus any of the
token/font flags to build a themed variant (used by export-theme-create.mjs
to bake a project theme's colors/fonts into its reference docs).

Usage:
    python tools/build-reference-docs.py
    python tools/build-reference-docs.py --out-dir path/to/theme/reference \
        --ink 0A1A2F --accent C8102E --heading-font Montserrat --body-font Inter

Outputs (under --out-dir, default templates/themes/doc-hub-light/reference):
    reference.docx
    reference.pptx

Design tokens applied (defaults shown; each overridable via CLI flag):
    Headings/Title  font=--heading-font   color=--ink      (ink)
    Body/defaults   font=--body-font      color=--body-color
    Table borders   hairline single       color=--rule
    Table header    shading fill          --panel
    PPTX accent1    --accent
    PPTX dk1 dark   --ink
"""

import argparse
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Pandoc discovery
# ---------------------------------------------------------------------------

def find_pandoc() -> str:
    """Return path to pandoc; check PATH first, then Windows local install."""
    p = shutil.which("pandoc")
    if p:
        return p
    fallback = Path.home() / "AppData" / "Local" / "Pandoc" / "pandoc.exe"
    if fallback.exists():
        return str(fallback)
    raise RuntimeError(
        "pandoc not found on PATH or in ~/AppData/Local/Pandoc/pandoc.exe"
    )


# ---------------------------------------------------------------------------
# DOCX: patch word/styles.xml
# ---------------------------------------------------------------------------

HEADING_STYLE_IDS = ["Title"] + [f"Heading{n}" for n in range(1, 10)]


def _table_borders(rule: str) -> str:
    return (
        "<w:tblBorders>"
        f'<w:top w:val="single" w:sz="4" w:space="0" w:color="{rule}"/>'
        f'<w:left w:val="single" w:sz="4" w:space="0" w:color="{rule}"/>'
        f'<w:bottom w:val="single" w:sz="4" w:space="0" w:color="{rule}"/>'
        f'<w:right w:val="single" w:sz="4" w:space="0" w:color="{rule}"/>'
        f'<w:insideH w:val="single" w:sz="4" w:space="0" w:color="{rule}"/>'
        f'<w:insideV w:val="single" w:sz="4" w:space="0" w:color="{rule}"/>'
        "</w:tblBorders>"
    )


def _header_shd(panel: str) -> str:
    return f'<w:shd w:val="clear" w:color="auto" w:fill="{panel}"/>'


def _patch_rpr_inner(rpr_inner: str, font: str, color: str) -> str:
    """Replace/insert w:rFonts and w:color inside an rPr inner string."""
    new_fonts = f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}"/>'
    new_color = f'<w:color w:val="{color}"/>'

    # rFonts: replace any existing form (ascii/hAnsi/theme refs)
    if re.search(r"<w:rFonts\b", rpr_inner):
        rpr_inner = re.sub(r"<w:rFonts\b[^/]*/>", new_fonts, rpr_inner)
    else:
        rpr_inner = new_fonts + rpr_inner

    # color: replace existing or insert right after rFonts
    if re.search(r"<w:color\b", rpr_inner):
        rpr_inner = re.sub(r"<w:color\b[^/]*/>", new_color, rpr_inner)
    else:
        rpr_inner = re.sub(
            r"(<w:rFonts\b[^/]*/>)",
            r"\1" + new_color,
            rpr_inner,
            count=1,
        )
    return rpr_inner


def _patch_style_rpr(block: str, font: str, color: str) -> str:
    """Patch the <w:rPr> inside a style block; insert one if absent."""
    rpr_m = re.search(r"(<w:rPr>)(.*?)(</w:rPr>)", block, re.DOTALL)
    if rpr_m:
        patched = _patch_rpr_inner(rpr_m.group(2), font, color)
        block = (
            block[: rpr_m.start()]
            + rpr_m.group(1)
            + patched
            + rpr_m.group(3)
            + block[rpr_m.end() :]
        )
    else:
        new_rpr = (
            f'<w:rPr><w:rFonts w:ascii="{font}" w:hAnsi="{font}"/>'
            f'<w:color w:val="{color}"/></w:rPr>'
        )
        block = re.sub(r"(</w:style>)", new_rpr + r"\1", block, count=1)
    return block


def patch_docx_styles(
    xml: str,
    *,
    ink: str = "090E22",
    body_color: str = "3A3F5C",
    rule: str = "DDE0EE",
    panel: str = "F8F9FC",
    heading_font: str = "Montserrat",
    body_font: str = "Inter",
) -> str:
    """Return patched word/styles.xml with the given theme fonts and colors."""

    # 1. docDefaults → body font + body color
    def _patch_doc_defaults(m: re.Match) -> str:
        inner = m.group(0)
        inner = re.sub(
            r"<w:rFonts\b[^/]*/>",
            f'<w:rFonts w:ascii="{body_font}" w:hAnsi="{body_font}" w:cs="{body_font}"/>',
            inner,
        )
        if "<w:color" not in inner:
            inner = re.sub(
                r"(<w:rFonts\b[^/]*/>)",
                rf'\1<w:color w:val="{body_color}"/>',
                inner,
                count=1,
            )
        else:
            inner = re.sub(
                r"<w:color\b[^/]*/>", f'<w:color w:val="{body_color}"/>', inner
            )
        return inner

    xml = re.sub(
        r"<w:docDefaults>.*?</w:docDefaults>",
        _patch_doc_defaults,
        xml,
        flags=re.DOTALL,
    )

    # 2. Normal style → body font + body color (Normal usually has no rPr → insert one)
    def _patch_normal(m: re.Match) -> str:
        return _patch_style_rpr(m.group(0), body_font, body_color)

    xml = re.sub(
        r'<w:style\b[^>]*w:styleId="Normal"[^>]*>.*?</w:style>',
        _patch_normal,
        xml,
        flags=re.DOTALL,
    )

    # 3. Title + Heading1-9 → heading font + ink color
    for sid in HEADING_STYLE_IDS:

        def _make_heading_replacer(style_id: str):
            def _replacer(m: re.Match) -> str:
                return _patch_style_rpr(m.group(0), heading_font, ink)
            return _replacer

        xml = re.sub(
            rf'<w:style\b[^>]*w:styleId="{re.escape(sid)}"[^>]*>.*?</w:style>',
            _make_heading_replacer(sid),
            xml,
            flags=re.DOTALL,
        )

    # 4. Table style → hairline borders + firstRow header shading
    def _patch_table(m: re.Match) -> str:
        block = m.group(0)
        # Insert tblBorders before </w:tblPr>
        block = re.sub(r"(</w:tblPr>)", _table_borders(rule) + r"\1", block, count=1)
        # Insert shading into firstRow tcPr
        block = re.sub(
            r"(<w:tblStylePr\b[^>]*w:type=\"firstRow\"[^>]*>.*?</w:tblStylePr>)",
            lambda fm: re.sub(
                r"(</w:tcPr>)", _header_shd(panel) + r"\1", fm.group(0), count=1, flags=re.DOTALL
            ),
            block,
            flags=re.DOTALL,
        )
        return block

    xml = re.sub(
        r'<w:style\b[^>]*w:styleId="Table"[^>]*>.*?</w:style>',
        _patch_table,
        xml,
        flags=re.DOTALL,
    )

    return xml


# ---------------------------------------------------------------------------
# PPTX: patch ppt/theme/theme1.xml
# ---------------------------------------------------------------------------


def patch_pptx_theme(
    xml: str,
    *,
    ink: str = "090E22",
    accent: str = "0B68B7",
    heading_font: str = "Montserrat",
    body_font: str = "Inter",
) -> str:
    """Return patched ppt/theme/theme1.xml with the given theme fonts and colors."""

    # majorFont latin → heading font (first <a:latin> inside <a:majorFont>…</a:majorFont>)
    xml = re.sub(
        r"(<a:majorFont>.*?<a:latin typeface=\")[^\"]*(\"/?>)",
        rf"\g<1>{heading_font}\g<2>",
        xml,
        flags=re.DOTALL,
    )

    # minorFont latin → body font
    xml = re.sub(
        r"(<a:minorFont>.*?<a:latin typeface=\")[^\"]*(\"/?>)",
        rf"\g<1>{body_font}\g<2>",
        xml,
        flags=re.DOTALL,
    )

    # dk1: patch lastClr on sysClr → ink (dark ink)
    xml = re.sub(
        r"(<a:dk1>.*?lastClr=\")[^\"]*(\"/?>.*?</a:dk1>)",
        rf"\g<1>{ink}\g<2>",
        xml,
        flags=re.DOTALL,
    )
    # dk1: also handle srgbClr form
    xml = re.sub(
        r"(<a:dk1>)<a:srgbClr\s+val=\"[^\"]*\"/>(</a:dk1>)",
        rf'\1<a:srgbClr val="{ink}"/>\2',
        xml,
    )

    # lt1: already FFFFFF — no change needed

    # accent1 → accent
    xml = re.sub(
        r"(<a:accent1>)<a:srgbClr\s+val=\"[^\"]*\"/>(</a:accent1>)",
        rf'\1<a:srgbClr val="{accent}"/>\2',
        xml,
    )

    return xml


# ---------------------------------------------------------------------------
# Zip rebuilder
# ---------------------------------------------------------------------------


def _rebuild_zip(src: Path, dst: Path, patches: dict[str, str | bytes]) -> None:
    """Rebuild a zip, substituting patched content; preserves member order + compression."""
    with zipfile.ZipFile(src, "r") as zin:
        with zipfile.ZipFile(dst, "w") as zout:
            for info in zin.infolist():
                if info.filename in patches:
                    data = patches[info.filename]
                    if isinstance(data, str):
                        data = data.encode("utf-8")
                    # Fresh ZipInfo preserves filename + compress_type; CRC/size recalculated
                    new_info = zipfile.ZipInfo(info.filename)
                    new_info.compress_type = info.compress_type
                    zout.writestr(new_info, data)
                else:
                    zout.writestr(info, zin.read(info.filename))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Build reference.docx/reference.pptx with the given theme tokens."
    )
    p.add_argument(
        "--out-dir",
        default=None,
        help="Output directory (default: templates/themes/doc-hub-light/reference)",
    )
    p.add_argument("--ink", default="090E22", help="Heading/title color (hex, no '#')")
    p.add_argument("--body-color", default="3A3F5C", help="Body text color (hex, no '#')")
    p.add_argument("--rule", default="DDE0EE", help="Table border color (hex, no '#')")
    p.add_argument("--panel", default="F8F9FC", help="Table header shading fill (hex, no '#')")
    p.add_argument("--accent", default="0B68B7", help="PPTX accent1 color (hex, no '#')")
    p.add_argument("--heading-font", default="Montserrat", help="Heading/title font family")
    p.add_argument("--body-font", default="Inter", help="Body font family")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    ink = args.ink.lstrip("#")
    body_color = args.body_color.lstrip("#")
    rule = args.rule.lstrip("#")
    panel = args.panel.lstrip("#")
    accent = args.accent.lstrip("#")
    heading_font = args.heading_font
    body_font = args.body_font

    pandoc = find_pandoc()
    root = Path(__file__).resolve().parent.parent
    tmp = Path(tempfile.gettempdir()) / "build-refdocs"
    tmp.mkdir(parents=True, exist_ok=True)
    templates = (
        Path(args.out_dir)
        if args.out_dir
        else root / "templates" / "themes" / "doc-hub-light" / "reference"
    )
    templates.mkdir(parents=True, exist_ok=True)

    written = 0

    # --- DOCX ---------------------------------------------------------------
    base_docx = tmp / "base.docx"
    subprocess.run(
        [pandoc, "-o", str(base_docx), "--print-default-data-file", "reference.docx"],
        check=True,
    )
    with zipfile.ZipFile(base_docx, "r") as z:
        styles_xml = z.read("word/styles.xml").decode("utf-8")

    patched_styles = patch_docx_styles(
        styles_xml,
        ink=ink,
        body_color=body_color,
        rule=rule,
        panel=panel,
        heading_font=heading_font,
        body_font=body_font,
    )
    _rebuild_zip(
        base_docx,
        templates / "reference.docx",
        {"word/styles.xml": patched_styles},
    )
    written += 1
    print(f"  wrote {templates / 'reference.docx'}")

    # --- PPTX ---------------------------------------------------------------
    base_pptx = tmp / "base.pptx"
    subprocess.run(
        [pandoc, "-o", str(base_pptx), "--print-default-data-file", "reference.pptx"],
        check=True,
    )
    with zipfile.ZipFile(base_pptx, "r") as z:
        theme_xml = z.read("ppt/theme/theme1.xml").decode("utf-8")

    patched_theme = patch_pptx_theme(
        theme_xml,
        ink=ink,
        accent=accent,
        heading_font=heading_font,
        body_font=body_font,
    )
    _rebuild_zip(
        base_pptx,
        templates / "reference.pptx",
        {"ppt/theme/theme1.xml": patched_theme},
    )
    written += 1
    print(f"  wrote {templates / 'reference.pptx'}")

    print(f"build-reference-docs: wrote {written} files")


if __name__ == "__main__":
    main()
