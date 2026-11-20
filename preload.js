const { contextBridge, ipcRenderer } = require('electron');
const OK = new Set(['state','set-instances','versions','login-ms','login-offline','logout','launch','mods-list','mods-search','mod-install','import-prism','open-folder','pick-skin','get-skin','set-avatar']);
contextBridge.exposeInMainWorld('api', {
  invoke: (ch, ...a) => OK.has(ch) ? ipcRenderer.invoke(ch, ...a) : Promise.reject(new Error('blocked')),
  onLog: (fn) => ipcRenderer.on('log', (_, m) => fn(String(m))),
});
