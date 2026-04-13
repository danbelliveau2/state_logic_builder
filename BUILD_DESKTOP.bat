@echo off
title SDC State Logic Builder - Desktop Build
set APP_DIR=C:\SDC-StateLogic

echo.
echo  ============================================================
echo   SDC State Logic Builder - Build Desktop App
echo  ============================================================
echo.
echo  This creates a standalone .exe your team can run without
echo  needing Node.js, npm, or any technical setup.
echo.
echo  Output: %APP_DIR%\release\SDC-State-Logic-Builder.exe
echo.

cd /d "%APP_DIR%"

if not exist "node_modules\" (
  echo  Installing dependencies...
  call npm install
  if errorlevel 1 ( echo ERROR: npm install failed & pause & exit /b 1 )
  echo.
)

echo  Step 1: Building React app...
call npm run build
if errorlevel 1 ( echo ERROR: Build failed & pause & exit /b 1 )
echo  Build complete.
echo.

echo  Step 2: Packaging as desktop app...
call npx electron-builder --win portable
if errorlevel 1 ( echo ERROR: Packaging failed & pause & exit /b 1 )

echo.
echo  ============================================================
echo   DONE!
echo  ============================================================
echo.
echo  Your app is at: %APP_DIR%\release\SDC-State-Logic-Builder.exe
echo.
echo  To share with your team:
echo    Copy SDC-State-Logic-Builder.exe to their desktop.
echo    Double-click to run - no install needed!
echo.
echo  NOTE: Each person's projects are saved on THEIR OWN computer.
echo        For shared projects, use BUILD_AND_RUN.bat on a server
echo        and have everyone connect via the network URL.
echo.
pause
