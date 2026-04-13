@echo off
cd /d C:\SDC-StateLogic

echo Building...
call npm run build
if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)
echo Build OK

echo Syncing to N drive...
robocopy "C:\SDC-StateLogic\dist" "N:\AI Folder\State Logic Diagrams\dist" /MIR /NFL /NDL
set RC=%ERRORLEVEL%
if %RC% GEQ 8 (
  echo SYNC FAILED rc=%RC%
  exit /b 1
)
echo Sync OK rc=%RC%
