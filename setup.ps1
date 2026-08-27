$ErrorActionPreference = "Stop"
Write-Host "Brightspace Sync setup"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js 20+ is required. Install it from https://nodejs.org/ then rerun this script." -ForegroundColor Yellow
  exit 1
}

node --version
npm install

if (-not (Test-Path "config.json")) {
  Copy-Item "config.example.json" "config.json"
  Write-Host "Created config.json"
}

Write-Host ""
Write-Host "Setup complete. Run QUICK_SYNC.cmd or FULL_SYNC.cmd" -ForegroundColor Green
