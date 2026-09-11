const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getVersion: () => ipcRenderer.invoke('get-app-version'),
    showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    platform: process.platform
});
