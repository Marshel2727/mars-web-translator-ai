$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ServerDir = Join-Path $Root "server"
$Python = Join-Path $ServerDir "venv\Scripts\python.exe"
$OllamaUrl = "http://127.0.0.1:11434/api/tags"
$OllamaGenerateUrl = "http://127.0.0.1:11434/api/generate"
$EnvFile = Join-Path $ServerDir ".env"
$OllamaModel = "mars-translator:qwen2.5-3b"
$StartedOllama = $false
$OllamaProcess = $null

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match "^\s*OLLAMA_MODEL\s*=\s*(.+?)\s*$") {
            $OllamaModel = $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
}

function Test-OllamaReady {
    try {
        Invoke-WebRequest -Uri $OllamaUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Wait-OllamaReady {
    for ($i = 0; $i -lt 30; $i++) {
        if (Test-OllamaReady) {
            return $true
        }

        Start-Sleep -Seconds 1
    }

    return $false
}

function Stop-OllamaModel {
    if (-not (Test-OllamaReady)) {
        return
    }

    try {
        $body = @{
            model = $OllamaModel
            keep_alive = 0
        } | ConvertTo-Json -Compress

        Invoke-RestMethod `
            -Uri $OllamaGenerateUrl `
            -Method Post `
            -Body $body `
            -ContentType "application/json" `
            -TimeoutSec 15 | Out-Null

        Write-Host "Unloaded Ollama model: $OllamaModel"
    } catch {
        Write-Host "Could not unload Ollama model automatically."
    }
}

function Test-OllamaModelUsesGpu {
    try {
        $body = @{
            model = $OllamaModel
            prompt = "OK"
            stream = $false
            keep_alive = "30m"
            options = @{
                num_predict = 1
                temperature = 0
            }
        } | ConvertTo-Json -Compress -Depth 4

        Invoke-RestMethod `
            -Uri $OllamaGenerateUrl `
            -Method Post `
            -Body $body `
            -ContentType "application/json" `
            -TimeoutSec 60 | Out-Null

        $modelNamePattern = [regex]::Escape($OllamaModel)
        $loadedModel = ollama ps | Where-Object {
            $_ -match $modelNamePattern
        } | Select-Object -First 1

        if (-not $loadedModel) {
            return $false
        }

        return $loadedModel -match "\bGPU\b"
    } catch {
        return $false
    }
}

try {
    Write-Host "Checking Ollama..."

    if (-not (Test-OllamaReady)) {
        Write-Host "Ollama is not running. Starting Ollama..."
        $OllamaProcess = Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden -PassThru
        $StartedOllama = $true

        Write-Host "Waiting for Ollama to be ready..."
        if (-not (Wait-OllamaReady)) {
            throw "Failed to start Ollama. Please run 'ollama serve' manually and try again."
        }
    } else {
        Write-Host "Ollama is already running."
    }

    Write-Host "Checking whether Ollama model uses GPU..."
    if (-not (Test-OllamaModelUsesGpu)) {
        Stop-OllamaModel
        throw "Ollama model '$OllamaModel' is not using GPU. Backend will not start."
    }

    Write-Host "Ollama model is using GPU."

    if (-not (Test-Path $Python)) {
        throw "Python virtual environment was not found: $Python"
    }

    Write-Host "Starting backend..."
    Write-Host "Press CTRL+C to stop backend$(if ($StartedOllama) { ' and Ollama.' } else { '.' })"
    Set-Location $ServerDir
    & $Python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
} finally {
    Write-Host ""
    Write-Host "Releasing Ollama GPU memory..."
    Stop-OllamaModel

    if ($StartedOllama -and $null -ne $OllamaProcess) {
        Write-Host ""
        Write-Host "Stopping Ollama..."
        Stop-Process -Id $OllamaProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
