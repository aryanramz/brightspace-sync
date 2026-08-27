@echo off
cd /d "%~dp0"
echo Brightspace Sync v2.2.0-rc1 - FULL (START_HERE compatibility launcher)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js 20+ is not installed.
  echo Install Node.js LTS from https://nodejs.org/ and run START_HERE.cmd again.
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
echo Running full Brightspace mirror...
call npm run full
if errorlevel 1 goto :error
echo.
echo Full sync finished.
pause
exit /b 0
:error
echo.
echo The sync stopped with an error. Leave this window open and review the error output or open a GitHub issue.
pause
exit /b 1
