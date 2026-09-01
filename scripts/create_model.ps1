$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ModelName = "mars-translator-qwen3:latest"
$ModelFile = Join-Path $Root "Modelfile"

ollama pull qwen3:8b
ollama create $ModelName -f $ModelFile
ollama show $ModelName
