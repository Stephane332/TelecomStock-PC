@echo off
chcp 65001 >nul 2>&1
title Installation TelecomStock Pro

echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║           📱 TelecomStock Pro - Installation                ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

REM Vérifier Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js n'est pas installé !
    echo    Téléchargez-le depuis https://nodejs.org
    pause
    exit /b 1
)

REM Dossier d'installation
set "INSTALL_DIR=C:\TelecomStock"
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

REM Copier les fichiers
echo 📦 Installation dans %INSTALL_DIR%...
xcopy /E /Y "%~dp0*" "%INSTALL_DIR%"

REM Installer les dépendances
cd /d "%INSTALL_DIR%"
echo 📦 Installation des dépendances...
call npm install

REM Créer un raccourci sur le bureau
echo 🚀 Création du raccourci...
set "DESKTOP=%USERPROFILE%\Desktop"
copy "%INSTALL_DIR%\Lancer-TelecomStock.bat" "%DESKTOP%\TelecomStock Pro.bat"

echo.
echo ✅ Installation terminée !
echo    Dossier : %INSTALL_DIR%
echo    Raccourci : Bureau → TelecomStock Pro.bat
echo.
echo    Appuyez sur une touche pour démarrer...
pause >nul

REM Démarrer
call "%INSTALL_DIR%\Lancer-TelecomStock.bat"