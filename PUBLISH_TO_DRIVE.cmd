@echo off
cd /d "%~dp0"
echo Brightspace Sync v2.4.1 - PUBLISH TO GOOGLE DRIVE
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js 20+ is not installed.
  pause
  exit /b 1
)
if not exist config.json copy /Y config.example.json config.json >nul
if not exist node_modules (
  echo Installing locked dependencies...
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto :error
)
echo.
echo Publishing the current mirror to Google Drive for desktop...
call npm run publish
if errorlevel 2 goto :warning
if errorlevel 1 goto :error
echo.
echo Drive publish finished.
pause
exit /b 0
:warning
echo.
echo The publish completed with one or more file errors. The next publish will retry them.
pause
exit /b 0
:error
echo.
echo The Drive publish stopped with an error.
pause
exit /b 1
