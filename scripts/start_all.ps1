$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ServerDir = Join-Path $Root "server"
$Python = Join-Path $ServerDir "venv\Scripts\python.exe"
$EnvFile = Join-Path $ServerDir ".env"
$ActiveModelFile = Join-Path $ServerDir "app\data\active_model.json"
$OllamaBaseUrl = "http://127.0.0.1:11434"
$OllamaModel = "mars-translator-qwen3:latest"
$StartedOllama = $false
$OllamaProcess = $null
$ModelLoaded = $false

function ConvertTo-CanonicalModelName([string]$Name) {
    $trimmed = $Name.Trim()
    $leaf = ($trimmed -split '/')[-1]
    if ($leaf -notmatch ':') {
        return "${trimmed}:latest"
    }
    return $trimmed
}

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match "^\s*OLLAMA_MODEL\s*=\s*(.+?)\s*$") {
            $OllamaModel = $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
}

if (Test-Path $ActiveModelFile) {
    try {
        $persisted = Get-Content $ActiveModelFile -Raw | ConvertFrom-Json
        if (-not [string]::IsNullOrWhiteSpace($persisted.model)) {
            $OllamaModel = $persisted.model
        }
    } catch {
        throw "File model aktif tidak valid: $ActiveModelFile. $($_.Exception.Message)"
    }
}
$OllamaModel = ConvertTo-CanonicalModelName $OllamaModel

function Test-OllamaReady {
    try {
        Invoke-RestMethod -Uri "$OllamaBaseUrl/api/tags" -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Wait-OllamaReady {
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        if (Test-OllamaReady) {
            return
        }
        Start-Sleep -Seconds 1
    }
    throw "Ollama tidak siap setelah 30 detik. Jalankan 'ollama serve' dan periksa log Ollama."
}

function Assert-ModelInstalled {
    $tags = Invoke-RestMethod -Uri "$OllamaBaseUrl/api/tags" -TimeoutSec 5
    $installed = @($tags.models | ForEach-Object { ConvertTo-CanonicalModelName $_.name })
    if ($OllamaModel -notin $installed) {
        throw "Model '$OllamaModel' tidak terpasang. Jalankan .\scripts\create_model.ps1 terlebih dahulu."
    }
}

function Load-OllamaModel {
    $body = @{
        model = $OllamaModel
        prompt = ""
        stream = $false
        keep_alive = "30m"
        options = @{ num_predict = 1 }
    } | ConvertTo-Json -Compress -Depth 4

    try {
        Invoke-RestMethod -Uri "$OllamaBaseUrl/api/generate" -Method Post -Body $body `
            -ContentType "application/json" -TimeoutSec 120 | Out-Null
        $script:ModelLoaded = $true
    } catch {
        throw "Model '$OllamaModel' gagal dimuat oleh Ollama: $($_.Exception.Message)"
    }
}

function Assert-ModelUsesGpu {
    try {
        $running = Invoke-RestMethod -Uri "$OllamaBaseUrl/api/ps" -TimeoutSec 10
    } catch {
        throw "Gagal membaca status GPU dari /api/ps: $($_.Exception.Message)"
    }

    $entry = $running.models | Where-Object {
        $runningName = $_.name
        if ([string]::IsNullOrWhiteSpace($runningName)) {
            $runningName = $_.model
        }
        (ConvertTo-CanonicalModelName $runningName) -eq $OllamaModel
    } | Select-Object -First 1

    if ($null -eq $entry) {
        throw "Model '$OllamaModel' tidak muncul di /api/ps setelah proses load."
    }
    $sizeVram = 0
    if ($null -ne $entry.size_vram) {
        $sizeVram = [int64]$entry.size_vram
    }
    if ($sizeVram -le 0) {
        $deviceHint = ""
        if (Get-Command Get-PnpDevice -ErrorAction SilentlyContinue) {
            $displayProblems = @(Get-PnpDevice -Class Display -ErrorAction SilentlyContinue | Where-Object {
                $_.Status -ne "OK" -or $_.Present -eq $false
            })
            if ($displayProblems.Count -gt 0) {
                $problemText = ($displayProblems | ForEach-Object {
                    "$($_.FriendlyName): Status=$($_.Status), Present=$($_.Present), Problem=$($_.Problem)"
                }) -join "; "
                $deviceHint = " Windows mendeteksi masalah perangkat display: $problemText."
            }
        }
        throw "Model '$OllamaModel' terpasang tetapi size_vram=0; GPU wajib digunakan sehingga backend dibatalkan.$deviceHint"
    }
}

function Stop-OllamaModel {
    if (-not $ModelLoaded -or -not (Test-OllamaReady)) {
        return
    }
    try {
        $body = @{ model = $OllamaModel; keep_alive = 0 } | ConvertTo-Json -Compress
        Invoke-RestMethod -Uri "$OllamaBaseUrl/api/generate" -Method Post -Body $body `
            -ContentType "application/json" -TimeoutSec 15 | Out-Null
        Write-Host "Unloaded Ollama model: $OllamaModel"
    } catch {
        Write-Warning "Model '$OllamaModel' gagal dilepas: $($_.Exception.Message)"
    } finally {
        $script:ModelLoaded = $false
    }
}

try {
    Write-Host "Checking Ollama..."
    if (-not (Test-OllamaReady)) {
        Write-Host "Ollama is not running. Starting Ollama..."
        $OllamaProcess = Start-Process -FilePath "ollama" -ArgumentList "serve" `
            -WindowStyle Hidden -PassThru
        $StartedOllama = $true
        Write-Host "Waiting for Ollama to be ready..."
        Wait-OllamaReady
    } else {
        Write-Host "Ollama is already running."
    }

    Assert-ModelInstalled
    Write-Host "Loading model and checking GPU: $OllamaModel"
    Load-OllamaModel
    Assert-ModelUsesGpu
    Write-Host "GPU verification passed."

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
        Write-Host "Stopping Ollama instance started by this script..."
        Stop-Process -Id $OllamaProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
