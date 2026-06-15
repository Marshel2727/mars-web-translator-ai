#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_NAME="mars-translator:gemma3-4b"

ollama create "$MODEL_NAME" -f "$ROOT/Modelfile"
ollama list
