@echo off
cd /d "%~dp0"
echo Brightspace Sync v2.2.0 - QUICK
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js 20+ is not installed.
  echo Install Node.js LTS from https://nodejs.org/ and run QUICK_SYNC.cmd again.
  pause
  exit /b 1
)
if not exist config.json copy /Y config.example.json config.json >nul
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :error
)
echo.
echo Running quick Brightspace check...
call npm run quick
if errorlevel 1 goto :error
echo.
echo Quick sync finished.
pause
exit /b 0
:error
echo.
echo The sync stopped with an error. Leave this window open and review the error output or open a GitHub issue.
pause
exit /b 1
