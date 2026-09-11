/**
 * TelecomStock Pro — Electron main process
 * Clean, minimal, starts backend server then loads the UI
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, Notification } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;

const PORT = 3002;
const isDev = !app.isPackaged;

// Get paths
function getAppPath() {
    if (isDev) return __dirname;
    // In packaged app, extraResources contains backend
    return path.join(process.resourcesPath, 'app');
}

function getBackendPath() {
    if (isDev) return path.join(__dirname, '..', 'backend', 'server.js');
    // When packaged, backend is in the app folder (specified in build.files)
    return path.join(process.resourcesPath, 'app', 'backend', 'server.js');
}

function getPublicPath() {
    if (isDev) return path.join(__dirname, '..', 'public');
    return path.join(process.resourcesPath, 'app', 'public');
}

// Start the backend server
function startBackend() {
    const serverPath = getBackendPath();
    console.log(`Starting backend: ${serverPath}`);
    
    serverProcess = spawn('node', [serverPath], {
        env: { ...process.env, PORT: String(PORT) },
        stdio: 'inherit'
    });
    
    serverProcess.on('exit', (code) => {
        console.log(`Backend exited with code ${code}`);
        serverProcess = null;
    });
}

// Wait for server to be ready
function waitForServer(retries = 30) {
    return new Promise((resolve, reject) => {
        const http = require('http');
        const tryConnect = (n) => {
            if (n <= 0) return reject(new Error('Server failed to start'));
            const req = http.get(`http://localhost:${PORT}/api/health`, (res) => {
                if (res.statusCode === 200) resolve();
                else setTimeout(() => tryConnect(n - 1), 500);
            });
            req.on('error', () => setTimeout(() => tryConnect(n - 1), 500));
        };
        tryConnect(retries);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        title: 'TelecomStock Pro',
        backgroundColor: '#F3F4F6',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        show: false,
        icon: path.join(getPublicPath(), 'icon.png')
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    mainWindow.loadURL(`http://localhost:${PORT}`);

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            return false;
        }
    });

    mainWindow.on('minimize', (event) => {
        event.preventDefault();
        mainWindow.hide();
    });

    // Open external links in browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

function createTray() {
    const iconPath = path.join(getPublicPath(), 'icon.png');
    let trayIcon;
    try {
        const { nativeImage } = require('electron');
        trayIcon = nativeImage.createFromPath(iconPath);
        if (trayIcon.isEmpty()) trayIcon = nativeImage.createEmpty();
    } catch {
        const { nativeImage } = require('electron');
        trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);

    const contextMenu = Menu.buildFromTemplate([
        { label: '📱 Ouvrir TelecomStock', click: () => { mainWindow.show(); mainWindow.focus(); } },
        { type: 'separator' },
        { label: '📊 Tableau de bord', click: () => { mainWindow.show(); mainWindow.webContents.send('navigate', 'dashboard'); } },
        { label: '📦 Produits', click: () => { mainWindow.show(); mainWindow.webContents.send('navigate', 'products'); } },
        { type: 'separator' },
        { label: '🚪 Quitter', click: () => { isQuitting = true; app.quit(); } }
    ]);

    tray.setToolTip('TelecomStock Pro');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

// IPC handlers
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('show-notification', (event, { title, body }) => {
    new Notification({ title, body }).show();
});
ipcMain.handle('open-external', (event, url) => shell.openExternal(url));

// App lifecycle
app.whenReady().then(async () => {
    try {
        startBackend();
        await waitForServer();
        createWindow();
        createTray();
    } catch (e) {
        console.error('Failed to start:', e);
        app.quit();
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
        else mainWindow.show();
    });
});

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        isQuitting = true;
        app.quit();
    }
});

app.on('quit', () => {
    if (serverProcess) {
        serverProcess.kill();
        serverProcess = null;
    }
});
