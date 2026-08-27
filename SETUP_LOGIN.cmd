@echo off
cd /d "%~dp0"
echo Brightspace Sync v2.4.0 - ESTABLISH DEDICATED BRAVE SESSION
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is not installed.
  pause
  exit /b 1
)
if not exist config.json copy /Y config.example.json config.json >nul
node src\login-setup.mjs
if errorlevel 1 goto :error
echo.
echo Dedicated Brave profile opened.
echo Sign in normally, optionally let Brave save the login, then close that Brave window.
pause
exit /b 0
:error
echo.
echo Could not open the dedicated login profile.
pause
exit /b 1
