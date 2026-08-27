$ErrorActionPreference = "Stop"
Write-Host "Brightspace Sync setup"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js 20+ is required. Install it from https://nodejs.org/ then rerun this script." -ForegroundColor Yellow
  exit 1
}

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) {
  Write-Host "Node.js 20+ is required. Current version:" -ForegroundColor Red
  node --version
  exit 1
}

node --version
Write-Host "Installing locked dependencies..."
npm ci --no-audit --no-fund

if (-not (Test-Path "config.json")) {
  Copy-Item "config.example.json" "config.json"
  Write-Host "Created config.json"
}

Write-Host ""
Write-Host "Running environment checks..."
npm run doctor

Write-Host ""
Write-Host "Setup complete. Edit config.json, then run SETUP_LOGIN.cmd followed by FULL_SYNC.cmd." -ForegroundColor Green
