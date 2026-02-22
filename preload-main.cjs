const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  pushSubtitle: (text) => ipcRenderer.send('overlay:subtitle', text),
  clearSubtitles: () => ipcRenderer.send('overlay:clear'),
  setOverlayStyle: (style) => ipcRenderer.invoke('overlay:setStyle', style),
  setOverlayVisible: (visible) => ipcRenderer.invoke('overlay:setVisible', visible),
  getOverlayState: () => ipcRenderer.invoke('overlay:getState')
});
