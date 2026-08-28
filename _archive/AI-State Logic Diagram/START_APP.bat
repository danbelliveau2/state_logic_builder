@echo off
title SDC State Logic Builder

REM Relaunch in persistent shell so window never closes
if "%1"=="GO" goto :main
cmd /k "%~f0" GO
exit /b

:main
echo.
echo  ========================================
echo   SDC State Logic Builder
echo  ========================================
echo.

REM Vite cannot run from UNC network paths (N: = \\SERVER-DC1\...).
REM Fix: sync source files to C:\SDC-StateLogic and run from there.
REM Your project files stay safely on N: - just copied locally to run.

set SOURCE=%~dp0
set LOCAL=C:\SDC-StateLogic

echo  Network source: %SOURCE%
echo  Local run path: %LOCAL%
echo.

REM Create local folder if needed
if not exist "%LOCAL%" mkdir "%LOCAL%"

REM Sync source files from N: to C:
echo  Syncing files to local drive...
xcopy "%SOURCE%src"            "%LOCAL%\src\"         /s /e /y /q
xcopy "%SOURCE%public"         "%LOCAL%\public\"      /s /e /y /q 2>nul
copy  "%SOURCE%package.json"   "%LOCAL%\package.json" /y >nul
copy  "%SOURCE%vite.config.js" "%LOCAL%\vite.config.js" /y >nul
copy  "%SOURCE%index.html"     "%LOCAL%\index.html"   /y >nul
echo  [OK] Files synced to C:\SDC-StateLogic
echo.

REM Run everything from the local C: copy
cd /d "%LOCAL%"

REM Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo  [!!] Node.js NOT found. Opening download page...
    start "" "https://nodejs.org/en/download"
    goto :end
)

echo  [OK] Node.js: & node --version
echo  [OK] npm:     & npm --version
echo.

REM Clear stale Vite dep cache
if exist "node_modules\.vite" (
    echo  Clearing Vite cache...
    rmdir /s /q "node_modules\.vite"
    echo  [OK] Cache cleared.
    echo.
)

REM Install packages if not present
if not exist "node_modules" (
    echo  Installing packages - please wait 1-2 minutes...
    npm install
    if %ERRORLEVEL% NEQ 0 (
        echo  [!!] npm install FAILED - error %ERRORLEVEL%
        goto :end
    )
    echo  [OK] Packages installed.
    echo.
)

echo  ----------------------------------------
echo  Starting app at http://localhost:3131
echo  Browser will open automatically.
echo  Leave this window open while using app.
echo  Press Ctrl+C to stop the server.
echo  ----------------------------------------
echo.

npm run dev

echo.
echo  [!!] Server stopped - error code: %ERRORLEVEL%

:end
echo.
echo  Done. Window staying open - close when finished.
echo.
