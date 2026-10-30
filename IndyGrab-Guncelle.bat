@echo off
setlocal EnableExtensions
title IndyGrab Guncelleyici

rem Betigi her zaman kendi bulundugu proje klasorunden calistir.
cd /d "%~dp0"

echo.
echo ==========================================
echo        IndyGrab Guncelleyici
echo ==========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
    echo HATA: Git bulunamadi.
    echo Git'i https://git-scm.com/download/win adresinden kurup tekrar deneyin.
    echo Kurulumda "Git from the command line" secenegini etkin birakin.
    echo.
    pause
    exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo HATA: Bu dosya IndyGrab proje klasorunde calistirilmali.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%A in ('git status --porcelain') do set "HAS_LOCAL_CHANGES=1"
if defined HAS_LOCAL_CHANGES (
    echo HATA: Yerelde degistirilmis veya yeni dosyalar bulundu.
    echo Guvenlik icin guncelleme yapilmadi; dosyalariniz ezilmedi.
    echo Degisiklikleri kaydedin ya da teknik destekle gorusun.
    echo.
    git status --short
    echo.
    pause
    exit /b 1
)

echo Guncellemeler kontrol ediliyor...
git fetch --prune origin
if errorlevel 1 (
    echo.
    echo HATA: GitHub'a baglanilamadi veya erisim yetkiniz yok.
    echo Internet baglantinizi ve GitHub girisinizi kontrol edin.
    echo.
    pause
    exit /b 1
)

git pull --ff-only origin main
if errorlevel 1 (
    echo.
    echo HATA: Guncelleme tamamlanamadi. Teknik destekle gorusun.
    echo.
    pause
    exit /b 1
)

echo.
echo Guncelleme basariyla tamamlandi.
echo Yeni kodun etkinlesmesi icin Chrome'u kapatip acin
echo veya chrome://extensions sayfasindan IndyGrab icin Yenile'ye basin.
echo.
pause
exit /b 0
