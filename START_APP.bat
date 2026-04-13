@echo off
title SDC State Logic Builder

:: Always run from the source directory on C: drive (has correct config + node_modules)
set APP_DIR=C:\SDC-StateLogic

echo.
echo  ============================================
echo   SDC State Logic Builder
echo  ============================================
echo  Running from: %APP_DIR%
echo  Browser will open automatically at http://localhost:3131
echo  Close this window to stop both servers.
echo.

cd /d "%APP_DIR%"

if not exist "node_modules\" (
  echo  Installing dependencies - please wait...
  npm install
  echo.
)

:: Start the project API server in the background on port 3000
:: Vite dev server proxies /api requests to this port
echo  Starting project API server on port 3000...
start "SDC-API-Server" /B cmd /C "set PORT=3000 && node server.js"

:: Small delay to let the API server start before Vite
timeout /t 2 /nobreak >nul

:: Start Vite dev server (port 3131) — this blocks until closed
echo  Starting Vite dev server on port 3131...
npm run dev
