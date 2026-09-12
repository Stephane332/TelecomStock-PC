/**
 * TelecomStock Pro — processus principal Electron.
 *
 * Le serveur API tourne DANS ce processus (require direct, pas de spawn) :
 * l'application est donc autonome et ne nécessite aucun Node.js installé.
 */
const { app, BrowserWindow, Tray, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');

// Nom de dossier stable et lisible pour les données utilisateur.
app.setName('TelecomStock Pro');

// La base vit dans le dossier utilisateur : elle survit aux mises à jour
// et reste accessible en écriture même si l'app est installée sous Program Files.
process.env.TS_DATA_DIR = path.join(app.getPath('appData'), 'TelecomStock Pro', 'data');

let mainWindow = null;
let tray = null;
let server = null;
let serverUrl = '';
let lanUrls = [];
let isQuitting = false;

// Empêche deux instances concurrentes d'ouvrir la même base SQLite.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
    bootstrap();
}

/**
 * Port FIXE et écoute sur toutes les interfaces : c'est ce qui permet aux
 * téléphones (APK) du réseau de la boutique de joindre ce poste de caisse.
 * Un port aléatoire rendrait l'adresse à saisir sur le mobile imprévisible.
 */
const LAN_PORT = Number(process.env.TS_PORT) || 3002;

async function startServer() {
    const { start, localAddresses } = require('../backend/server');
    try {
        server = await start(LAN_PORT, '0.0.0.0');
    } catch (e) {
        // Port déjà pris : on se replie en local pour que le poste reste utilisable.
        if (e && e.code === 'EADDRINUSE') {
            server = await start(0, '127.0.0.1');
        } else {
            throw e;
        }
    }
    const port = server.address().port;
    serverUrl = `http://127.0.0.1:${port}`;
    lanUrls = localAddresses().map(ip => `http://${ip}:${port}`);
    return serverUrl;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1380,
        height: 880,
        minWidth: 960,
        minHeight: 640,
        title: 'TelecomStock Pro',
        backgroundColor: '#F3F4F6',
        show: false,
        icon: path.join(__dirname, '..', 'public', 'assets', 'icon-512.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadURL(serverUrl);

    mainWindow.once('ready-to-show', () => mainWindow.show());

    // La croix réduit dans la zone de notification ; on quitte via le menu du tray.
    mainWindow.on('close', e => {
        if (!isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    // Les liens externes s'ouvrent dans le navigateur, jamais dans l'app.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith(serverUrl) || url === 'about:blank') return { action: 'allow' };
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Interdit toute navigation hors du serveur local.
    mainWindow.webContents.on('will-navigate', (e, url) => {
        if (!url.startsWith(serverUrl)) {
            e.preventDefault();
            shell.openExternal(url);
        }
    });
}

function createTray() {
    try {
        tray = new Tray(path.join(__dirname, '..', 'public', 'assets', 'icon-192.png'));
    } catch {
        return; // absence d'icône : le tray est un confort, pas une dépendance
    }
    tray.setToolTip('TelecomStock Pro');
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Ouvrir TelecomStock', click: () => { mainWindow.show(); mainWindow.focus(); } },
        { type: 'separator' },
        {
            label: 'Adresse pour les téléphones…',
            click: () => showLanInfo()
        },
        {
            label: 'Dossier des données',
            click: () => shell.openPath(process.env.TS_DATA_DIR)
        },
        { type: 'separator' },
        { label: 'Quitter', click: () => { isQuitting = true; app.quit(); } }
    ]));
    tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

/**
 * Affiche l'adresse à saisir dans l'application mobile ou le navigateur
 * d'un téléphone connecté au même réseau (Wi-Fi de la boutique).
 */
function showLanInfo() {
    const lignes = lanUrls.length
        ? lanUrls.join('\n')
        : "Aucun réseau détecté. Connectez ce PC au Wi-Fi de la boutique.";
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Adresse pour les téléphones',
        message: 'Saisissez cette adresse dans l\'application mobile :',
        detail: `${lignes}\n\nLe téléphone doit être sur le même Wi-Fi que ce PC.`,
        buttons: ['Fermer']
    });
}

/**
 * Autorise le port dans le pare-feu Windows pour les réseaux privés.
 * Sans cette règle, les téléphones de la boutique sont bloqués silencieusement.
 * L'opération est tentée sans élévation : si elle échoue, l'app fonctionne
 * quand même en local et le commerçant pourra autoriser manuellement.
 */
function ensureFirewallRule() {
    if (process.platform !== 'win32' || !server) return;
    const port = server.address().port;
    const nom = `TelecomStock Pro (${port})`;
    const { execFile } = require('child_process');
    // netsh échoue sans droits admin : on ignore l'erreur volontairement.
    execFile('netsh', [
        'advfirewall', 'firewall', 'add', 'rule',
        `name=${nom}`, 'dir=in', 'action=allow',
        'protocol=TCP', `localport=${port}`, 'profile=private'
    ], () => { /* sans privilèges : ignoré */ });
}

async function bootstrap() {
    await app.whenReady();
    try {
        await startServer();
        ensureFirewallRule();
        createWindow();
        createTray();
    } catch (e) {
        dialog.showErrorBox(
            'Démarrage impossible',
            `TelecomStock Pro n'a pas pu démarrer.\n\n${e.message}`
        );
        app.quit();
        return;
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
        else mainWindow.show();
    });
}

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:dataDir', () => process.env.TS_DATA_DIR);

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') { isQuitting = true; app.quit(); }
});

app.on('quit', () => {
    if (server) { try { server.close(); } catch { /* déjà fermé */ } }
});
