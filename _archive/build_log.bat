@echo off
cd /d C:\SDC-StateLogic
call npm run build > C:\SDC-StateLogic\build_output.txt 2>&1
echo BUILD_EXIT=%ERRORLEVEL% >> C:\SDC-StateLogic\build_output.txt
