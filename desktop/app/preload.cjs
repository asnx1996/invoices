// جسر شاشة الإعداد فقط (ملف محلي). صفحات السيرفر ما توصل لهذا
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('setup', {
    state: () => ipcRenderer.invoke('setup:state'),
    client: address => ipcRenderer.invoke('setup:client', address),
    server: opts => ipcRenderer.invoke('setup:server', opts),
  });
}
