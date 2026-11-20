#!/usr/bin/env bash
# Zips skill/lecture-exam-prep into public/downloads/ so Lectern serves it at /downloads/lecture-exam-prep.zip.
# Unzip into ~/.claude/skills/ (or a project's .claude/skills/) to install. Runs before every `npm run build`.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/downloads
rm -f public/downloads/lecture-exam-prep.zip
(cd skill && zip -qr -X ../public/downloads/lecture-exam-prep.zip lecture-exam-prep -x '*/__pycache__/*' '*.pyc' '*/.DS_Store')
echo "public/downloads/lecture-exam-prep.zip ($(du -h public/downloads/lecture-exam-prep.zip | cut -f1))"
