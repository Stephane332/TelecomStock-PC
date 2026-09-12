const { contextBridge, ipcRenderer } = require('electron');

// Surface minimale exposée au renderer : aucune primitive Node ne fuit.
contextBridge.exposeInMainWorld('telecomStock', {
    isDesktop: true,
    getVersion: () => ipcRenderer.invoke('app:version'),
    getDataDir: () => ipcRenderer.invoke('app:dataDir')
});
