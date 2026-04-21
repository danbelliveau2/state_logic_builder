/**
 * Preload script — runs in a sandboxed context before the renderer loads.
 * Exposes a safe, narrow API to the React app via window.electronAPI.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateStatus: (callback) => {
    const handler = (_, msg) => callback(msg);
    ipcRenderer.on('update-status', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('update-status', handler);
  },
  // Native save dialog — avoids showSaveFilePicker createWritable() bug in Electron
  saveFile: (fileName, content) => ipcRenderer.invoke('save-file', { fileName, content }),
  // Direct overwrite to a known path — no dialog, no "replace?" prompt
  saveFileDirect: (filePath, content) => ipcRenderer.invoke('save-file-direct', { filePath, content }),
});
