@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules" (
  echo Installing local dependencies for the first launch...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo Installation failed. Please install Node.js and run this file again.
    pause
    exit /b 1
  )
)

node scripts\start-local.mjs
endlocal
