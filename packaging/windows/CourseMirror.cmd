@echo off
setlocal

set "COURSEMIRROR_BUNDLE_ROOT=%~dp0"
set "COURSEMIRROR_PRIVATE_NODE=%COURSEMIRROR_BUNDLE_ROOT%runtime\node.exe"
set "COURSEMIRROR_APPLICATION_ENTRY=%COURSEMIRROR_BUNDLE_ROOT%app\src\launcher.mjs"
set "COURSEMIRROR_PLAYWRIGHT_PACKAGE=%COURSEMIRROR_BUNDLE_ROOT%app\node_modules\playwright\package.json"

if not exist "%COURSEMIRROR_PRIVATE_NODE%" (
  echo CourseMirror's private Node.js runtime is missing.
  echo Rebuild or reinstall CourseMirror.
  exit /b 1
)

if not exist "%COURSEMIRROR_APPLICATION_ENTRY%" (
  echo CourseMirror application files are missing.
  echo Rebuild or reinstall CourseMirror.
  exit /b 1
)

if not exist "%COURSEMIRROR_PLAYWRIGHT_PACKAGE%" (
  echo CourseMirror production dependencies are missing.
  echo Rebuild or reinstall CourseMirror.
  exit /b 1
)

"%COURSEMIRROR_PRIVATE_NODE%" "%COURSEMIRROR_APPLICATION_ENTRY%" %*
exit /b %ERRORLEVEL%
