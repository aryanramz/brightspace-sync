param(
  [ValidateSet("quick", "full")]
  [string]$Mode = "full"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
npm run $Mode
