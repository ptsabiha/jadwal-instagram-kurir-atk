@echo off
chcp 65001 >nul
cd /d "%~dp0"
node "alat/jadwal.mjs" status
echo.
node "alat/jadwal.mjs" daftar
echo.
pause
