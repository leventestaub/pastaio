# PowerShell dev runner — Windows equivalent of run_dev.sh
# Usage: .\scripts\run_dev.ps1
#
# Honors env vars set in the calling shell, e.g.:
#   $env:PASTAIO_REASONING_BACKEND = "ollama"
#   .\scripts\run_dev.ps1

$ErrorActionPreference = "Stop"

# Move to project root regardless of where the script is invoked from.
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Test-Path ".venv")) {
    Write-Host "Creating .venv and installing dependencies..."
    python -m venv .venv
    & .\.venv\Scripts\python.exe -m pip install -e ".[dev]"
}

& .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
