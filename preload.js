const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getVersion: () => ipcRenderer.invoke('get-app-version'),
    showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    saveDialog: (options) => ipcRenderer.invoke('save-dialog', options),
    openDialog: (options) => ipcRenderer.invoke('open-dialog', options),
    platform: process.platform
});