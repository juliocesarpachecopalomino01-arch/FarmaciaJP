@echo off
setlocal
cd /d "%~dp0"
set INCLUDE_DATABASE=1
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\Crear-Entregable.ps1"
endlocal
