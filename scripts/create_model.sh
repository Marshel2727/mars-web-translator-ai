#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_NAME="mars-translator-qwen3:latest"

ollama pull qwen3:8b
ollama create "$MODEL_NAME" -f "$ROOT/Modelfile"
ollama list
