const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  onSubtitle: (handler) => {
    const wrapped = (_event, text) => handler(text);
    ipcRenderer.on('overlay:subtitle', wrapped);
    return () => ipcRenderer.removeListener('overlay:subtitle', wrapped);
  },
  onClear: (handler) => {
    const wrapped = () => handler();
    ipcRenderer.on('overlay:clear', wrapped);
    return () => ipcRenderer.removeListener('overlay:clear', wrapped);
  },
  onStyle: (handler) => {
    const wrapped = (_event, style) => handler(style);
    ipcRenderer.on('overlay:style', wrapped);
    return () => ipcRenderer.removeListener('overlay:style', wrapped);
  }
});
