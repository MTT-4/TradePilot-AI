#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$ROOT_DIR/tmp/bge-server-venv"
PYTHON_BIN="$VENV_DIR/bin/python"
PIP_BIN="$VENV_DIR/bin/pip"

if [ ! -x "$PYTHON_BIN" ]; then
  python3 -m venv "$VENV_DIR"
fi

if ! "$PYTHON_BIN" -c "import numpy, onnxruntime, tokenizers" >/dev/null 2>&1; then
  "$PIP_BIN" install --upgrade pip
  "$PIP_BIN" install numpy onnxruntime tokenizers
fi

exec "$PYTHON_BIN" \
  "$ROOT_DIR/scripts/bge_m3_local_server.py" \
  --host "${BGE_HOST:-0.0.0.0}" \
  --port "${BGE_PORT:-8082}" \
  "$@"
