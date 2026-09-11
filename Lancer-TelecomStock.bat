@echo off
chcp 65001 >nul 2>&1
title TelecomStock Pro v1.0

echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║                                                              ║
echo ║              📱 TelecomStock Pro v1.0                        ║
echo ║           Gestion de stock pour télécoms                    ║
echo ║                                                              ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

REM Vérifier si Node.js est installé
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ ERREUR : Node.js n'est pas installé !
    echo.
echo    → Téléchargez Node.js depuis : https://nodejs.org
echo    → Installez la version LTS (Long Term Support)
echo    → Redémarrez votre ordinateur après l'installation
echo.
    pause
    exit /b 1
)

REM Aller dans le dossier du script
cd /d "%~dp0"

REM Vérifier si le serveur existe
if not exist "server.js" (
    echo ❌ ERREUR : Fichier server.js introuvable !
    echo    Assurez-vous que tous les fichiers sont dans le même dossier.
    pause
    exit /b 1
)

REM Vérifier si node_modules existe
if not exist "node_modules" (
    echo 📦 Installation des dépendances...
    call npm install
    echo.
)

REM Arrêter un éventuel serveur précédent
tasklist /FI "WINDOWTITLE eq TelecomStock Server" 2>nul | find /I "node.exe" >nul
if %errorlevel% equ 0 (
    echo 🔄 Arrêt du serveur précédent...
    taskkill /FI "WINDOWTITLE eq TelecomStock Server" /F >nul 2>&1
    timeout /t 2 /nobreak >nul
)

echo 🚀 Démarrage du serveur TelecomStock...
echo.

REM Démarrer le serveur en arrière-plan
start "TelecomStock Server" /min node server.js

REM Attendre que le serveur soit prêt
echo ⏳ Attente du démarrage...
set /a attempts=0
:check_server
curl -s http://localhost:3002/api/health >nul 2>&1
if %errorlevel% neq 0 (
    set /a attempts+=1
    if %attempts% gtr 30 (
        echo ⚠️  Le serveur met trop de temps à démarrer.
        echo    Vérifiez que le port 3002 est libre.
        pause
        exit /b 1
    )
    timeout /t 1 /nobreak >nul
    goto check_server
)

REM Ouvrir le navigateur
echo 🌐 Ouverture du navigateur...
start http://localhost:3002

echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║                    ✅ SERVEUR DÉMARRÉ                        ║
echo ╠══════════════════════════════════════════════════════════════╣
echo ║                                                              ║
echo ║   🌐 Accès : http://localhost:3002                          ║
echo ║   👤 Login : admin                                           ║
echo ║   🔑 Mot de passe : admin123                                 ║
echo ║                                                              ║
echo ║   Pour arrêter le serveur, fermez cette fenêtre.             ║
echo ║   Appuyez sur une touche pour fermer cette fenêtre...        ║
echo ║                                                              ║
echo ╚══════════════════════════════════════════════════════════════╝
pause >nul