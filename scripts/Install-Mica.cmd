@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Mica.ps1" -SourceDirectory "%~dp0."
if errorlevel 1 echo Installation failed. Existing documents have not been changed.
pause
