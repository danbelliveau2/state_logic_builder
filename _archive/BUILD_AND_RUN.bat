@echo off
title SDC State Logic Builder - Server
set APP_DIR=C:\SDC-StateLogic

echo.
echo  ============================================================
echo   SDC State Logic Builder - Build and Run Server
echo  ============================================================
echo.
echo  This builds the app and starts a server your WHOLE TEAM
echo  can access from any computer on the network.
echo.
echo  Projects are saved in: %APP_DIR%\data\projects\
echo  (Back up this folder to keep your work safe.)
echo.

cd /d "%APP_DIR%"

if not exist "node_modules\" (
  echo  Installing dependencies - please wait...
  call npm install
  if errorlevel 1 (
    echo  ERROR: npm install failed. Check Node.js is installed.
    pause
    exit /b 1
  )
  echo.
)

echo  Building app for production...
call npm run build
if errorlevel 1 (
  echo  ERROR: Build failed. Check the output above.
  pause
  exit /b 1
)
echo  Build complete.
echo.

echo  Starting server on port 3131...
echo  Share this address with your team once it starts:
echo.
node server.js
