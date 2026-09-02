param(
  [ValidateSet("quick", "full")]
  [string]$Mode = "full"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
node (Join-Path $PSScriptRoot "src\launcher.mjs") $Mode
