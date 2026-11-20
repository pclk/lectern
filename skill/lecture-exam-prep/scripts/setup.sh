#!/usr/bin/env bash
# One-time setup (idempotent). Installs ffmpeg-full (libass + rubberband), pandoc + typst (PDFs),
# and a shared Python venv with Parakeet ASR (MLX, Apple Silicon), numpy, pillow, pypdf.
# Usage: bash setup.sh            -> prints the python path to use for all scripts
set -euo pipefail
VENV="${LEP_VENV:-$HOME/.cache/lecture-exam-prep/venv}"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "WARNING: parakeet-mlx needs Apple Silicon. On other machines swap transcribe.py's model for faster-whisper (word_timestamps=True)." >&2
fi

need=()
[[ -x /opt/homebrew/opt/ffmpeg-full/bin/ffmpeg ]] || need+=(ffmpeg-full)
command -v pandoc >/dev/null || need+=(pandoc)
command -v typst  >/dev/null || need+=(typst)
if ((${#need[@]})); then
  echo "Installing with Homebrew: ${need[*]}" >&2
  HOMEBREW_NO_AUTO_UPDATE=1 brew install "${need[@]}" >&2
fi

if [[ ! -x "$VENV/bin/python" ]]; then
  mkdir -p "$(dirname "$VENV")"
  if command -v uv >/dev/null; then
    uv venv -q -p 3.12 "$VENV" >&2
    uv pip install -q -p "$VENV" parakeet-mlx numpy pillow pypdf >&2
  else
    python3 -m venv "$VENV" >&2
    "$VENV/bin/pip" install -q parakeet-mlx numpy pillow pypdf >&2
  fi
fi
"$VENV/bin/python" -c "import parakeet_mlx, numpy, PIL, pypdf" >&2
echo "$VENV/bin/python"
