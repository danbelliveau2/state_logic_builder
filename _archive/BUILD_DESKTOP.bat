@echo off
title SDC State Logic Builder - Local Dev Build
set APP_DIR=%CD%

echo.
echo  ============================================================
echo   SDC State Logic Builder - Local Dev Build (ZIP)
echo  ============================================================
echo.
echo  NOTE: This creates a LOCAL test build only.
echo.
echo  To release a new version to the team:
echo    1. Update "version" in package.json
echo    2. git commit + git push to main
echo    GitHub Actions will build the installer automatically.
echo.

if not exist "node_modules\" (
  echo  Installing dependencies...
  call npm install
  if errorlevel 1 ( echo. & echo ERROR: npm install failed & pause & exit /b 1 )
  echo.
)

echo  Step 1: Building React app...
call npm run build
if errorlevel 1 ( echo. & echo ERROR: Vite build failed & pause & exit /b 1 )
echo  Build complete.
echo.

echo  Step 2: Packaging (zip - no installer needed locally)...
call npx electron-builder --win zip --publish never
if errorlevel 1 ( echo. & echo ERROR: Electron packaging failed & pause & exit /b 1 )

echo.
echo  Step 3: Creating portable ZIP...
for /f "tokens=*" %%v in ('node -p "require('./package.json').version"') do set VERSION=%%v
powershell -Command "Compress-Archive -Path 'release\win-unpacked\*' -DestinationPath 'release\SDC-State-Logic-Builder-%VERSION%-local.zip' -Force"

echo.
echo  ============================================================
echo   LOCAL BUILD COMPLETE
echo  ============================================================
echo.
echo  Test build:  %APP_DIR%\release\SDC-State-Logic-Builder-%VERSION%-local.zip
echo.
echo  Extract and run "SDC State Logic Builder.exe" to test locally.
echo.
pause
