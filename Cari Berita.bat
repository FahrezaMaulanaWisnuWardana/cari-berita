@echo off
title Cari Berita
cd /d "%~dp0"
cls
echo ============================================
echo    CARI BERITA - Pencari Link Berita
echo ============================================
echo.

rem --- Cek Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js belum terpasang di komputer ini.
  echo.
  echo     Unduh Node.js versi LTS dari website berikut:
  echo     https://nodejs.org
  echo.
  echo     Pasang sekali saja, lalu klik dua kali file ini lagi.
  echo.
  pause
  exit /b 1
)

rem --- Cek versi Node.js: minimal harus versi 18 ---
set NODEMAJOR=
for /f "delims=. tokens=1" %%a in ('node -v') do set NODEOUT=%%a
if defined NODEOUT set NODEMAJOR=%NODEOUT:~1%
echo Node.js versi %NODEOUT% terpasang.
if not defined NODEMAJOR goto verlama
if %NODEMAJOR% LSS 18 goto verlama
goto verdone
:verlama
echo.
echo [X] Versi Node.js terlalu lama. Minimal butuh versi 18.
echo.
echo     Unduh versi LTS terbaru dari https://nodejs.org
echo     lalu pasang, dan klik dua kali file ini lagi.
echo.
pause
exit /b 1
:verdone
echo.

rem --- Siapkan aplikasi saat pertama kali dijalankan ---
if not exist "node_modules\express" (
  echo Menyiapkan aplikasi... mohon tunggu satu sampai dua menit.
  echo Ini hanya dilakukan satu kali saja.
  echo.
  call npm install --no-audit --no-fund
  echo.
)

rem --- Jika aplikasi sudah berjalan, cukup buka browser ---
netstat -o -n | findstr "LISTENING" | findstr ":3000" >nul 2>nul
if not errorlevel 1 (
  echo Cari Berita sudah berjalan. Membuka browser...
  start "" http://localhost:3000
  timeout /t 3 /nobreak >nul
  exit /b 0
)

rem --- Jalankan server dan buka browser ---
echo Menjalankan Cari Berita...
start "Cari Berita - JANGAN DITUTUP" /min node server.js
echo Membuka browser...
timeout /t 2 /nobreak >nul
start "" http://localhost:3000

echo.
echo ============================================
echo   Cari Berita siap digunakan di browser.
echo.
echo   Untuk mematikan:
echo   klik dua kali "Matikan Cari Berita.bat"
echo ============================================
echo.
timeout /t 10 >nul
exit /b 0
