@echo off
setlocal

set "BRIGHTSPACE_SYNC_BUNDLE_ROOT=%~dp0"
set "BRIGHTSPACE_SYNC_PRIVATE_NODE=%BRIGHTSPACE_SYNC_BUNDLE_ROOT%runtime\node.exe"
set "BRIGHTSPACE_SYNC_APPLICATION_ENTRY=%BRIGHTSPACE_SYNC_BUNDLE_ROOT%app\src\launcher.mjs"
set "BRIGHTSPACE_SYNC_PLAYWRIGHT_PACKAGE=%BRIGHTSPACE_SYNC_BUNDLE_ROOT%app\node_modules\playwright\package.json"

if not exist "%BRIGHTSPACE_SYNC_PRIVATE_NODE%" (
  echo Brightspace Sync's private Node.js runtime is missing.
  echo Rebuild or reinstall Brightspace Sync.
  exit /b 1
)

if not exist "%BRIGHTSPACE_SYNC_APPLICATION_ENTRY%" (
  echo Brightspace Sync application files are missing.
  echo Rebuild or reinstall Brightspace Sync.
  exit /b 1
)

if not exist "%BRIGHTSPACE_SYNC_PLAYWRIGHT_PACKAGE%" (
  echo Brightspace Sync production dependencies are missing.
  echo Rebuild or reinstall Brightspace Sync.
  exit /b 1
)

"%BRIGHTSPACE_SYNC_PRIVATE_NODE%" "%BRIGHTSPACE_SYNC_APPLICATION_ENTRY%" %*
exit /b %ERRORLEVEL%
