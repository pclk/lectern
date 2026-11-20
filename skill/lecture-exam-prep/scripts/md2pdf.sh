#!/usr/bin/env bash
# Markdown (with $LaTeX$ math, tables, YAML title block) -> A4 PDF via pandoc -> Typst.
# Usage: md2pdf.sh input.md output.pdf [--no-toc]
# Fixes baked in: lists directly under a text line still render as lists (agents often omit the blank line),
# and pandoc's vmatrix/determinant output (delim: "||") is rewritten to Typst's valid delim: "|".
# Check the result by rendering a few pages: typst compile <file>.typ "pg{0p}.png" --pages 1,2 --ppi 60
set -euo pipefail
in="$1"; out="$2"; toc="--toc"
[[ "${3:-}" == "--no-toc" ]] && toc=""
typ="${out%.pdf}.typ"
pandoc "$in" -f markdown+lists_without_preceding_blankline -s -t typst $toc --toc-depth=2 \
  -V papersize=a4 -V fontsize=10pt -V mainfont="Helvetica Neue" -V margin.x=1.8cm -V margin.y=2cm -o "$typ"
sed -i '' 's/delim: "||"/delim: "|"/g' "$typ" 2>/dev/null || sed -i 's/delim: "||"/delim: "|"/g' "$typ"
typst compile "$typ" "$out"
echo "$out"
