// جسر شاشات البرنامج المحلية فقط (ملفات file:). صفحات السيرفر ما توصل لهذا
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('setup', {
    state: () => ipcRenderer.invoke('setup:state'),
    client: address => ipcRenderer.invoke('setup:client', address),
    server: opts => ipcRenderer.invoke('setup:server', opts),
  });
  contextBridge.exposeInMainWorld('accounts', {
    list: () => ipcRenderer.invoke('accounts:list'),
    reset: (login, password) => ipcRenderer.invoke('accounts:reset', { login, password }),
  });
}
