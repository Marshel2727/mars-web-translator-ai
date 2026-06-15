#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/server"
PYTHON="$SERVER_DIR/venv/Scripts/python.exe"

cd "$SERVER_DIR"

"$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8000