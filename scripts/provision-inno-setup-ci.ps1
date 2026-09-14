[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedVersion = '7.1.0'
# Digest published for the immutable official GitHub release asset.
$ExpectedSha256 = '0362a383ed217d4c4239b5933866dd96d3eb2102737da92f80f6057a4b40df2f'
$DownloadUrl = 'https://github.com/jrsoftware/issrc/releases/download/is-7_1_0/innosetup-7.1.0-x64.exe'

if ($env:GITHUB_ACTIONS -ne 'true') {
    throw 'This provisioning script is CI-only. Local builds must use an existing Inno Setup installation or ISCC_PATH.'
}
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or [string]::IsNullOrWhiteSpace($env:GITHUB_ENV)) {
    throw 'GitHub Actions runner paths are unavailable.'
}

$downloadFile = Join-Path $env:RUNNER_TEMP 'innosetup-7.1.0-x64.exe'
$installDirectory = Join-Path $env:RUNNER_TEMP 'inno-setup-7.1.0-x64'

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $DownloadUrl -OutFile $downloadFile -UseBasicParsing

$actualSha256 = (Get-FileHash -LiteralPath $downloadFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -cne $ExpectedSha256) {
    throw "Inno Setup download SHA-256 mismatch: expected $ExpectedSha256, found $actualSha256."
}

$signature = Get-AuthenticodeSignature -LiteralPath $downloadFile
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Inno Setup download does not have a valid Authenticode signature: $($signature.Status)."
}

$install = Start-Process -FilePath $downloadFile -ArgumentList @(
    '/VERYSILENT',
    '/SUPPRESSMSGBOXES',
    '/NORESTART',
    '/SP-',
    '/CURRENTUSER',
    ('/DIR="{0}"' -f $installDirectory)
) -Wait -PassThru
if ($install.ExitCode -ne 0) {
    throw "Pinned Inno Setup provisioning failed with exit code $($install.ExitCode)."
}

$compilerPath = Join-Path $installDirectory 'ISCC.exe'
if (-not (Test-Path -LiteralPath $compilerPath -PathType Leaf)) {
    throw "Pinned Inno Setup compiler was not installed at the expected location: $compilerPath"
}
$versionInfo = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($compilerPath)
$actualVersion = '{0}.{1}.{2}' -f $versionInfo.FileMajorPart, $versionInfo.FileMinorPart, $versionInfo.FileBuildPart
if ($actualVersion -cne $ExpectedVersion -or $versionInfo.FilePrivatePart -ne 0) {
    throw "Provisioned Inno Setup compiler version mismatch: expected $ExpectedVersion, found $($versionInfo.FileVersion)."
}

Add-Content -LiteralPath $env:GITHUB_ENV -Value "ISCC_PATH=$compilerPath" -Encoding utf8
Write-Host "Provisioned verified Inno Setup $ExpectedVersion x64 for this CI job."
