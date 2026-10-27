@echo off
title Matikan Cari Berita
echo ============================================
echo    MEMATIKAN CARI BERITA
echo ============================================
echo.
echo Mematikan...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -Unique OwningProcess | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
echo.
echo Selesai. Cari Berita sudah dimatikan.
echo.
timeout /t 4 >nul
exit /b 0
