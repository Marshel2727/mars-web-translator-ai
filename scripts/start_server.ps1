$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ServerDir = Join-Path $Root "server"
$Python = Join-Path $ServerDir "venv\Scripts\python.exe"

Set-Location $ServerDir

& $Python -m uvicorn app.main:app --host 127.0.0.1 --port 8000