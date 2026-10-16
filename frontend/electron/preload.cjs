const { contextBridge, ipcRenderer } = require('electron');

let desktopConfig = null;
try {
  desktopConfig = ipcRenderer.sendSync('get-desktop-config');
} catch (err) {
  console.warn('[Preload] Failed to query desktop config via IPC:', err);
}

// Fallback to URL search parameters if IPC sync wasn't available
if (!desktopConfig && typeof window !== 'undefined' && window.location?.search) {
  try {
    const params = new URLSearchParams(window.location.search);
    const port = params.get('backendPort');
    if (port) {
      desktopConfig = {
        port: Number(port),
        apiBase: `http://127.0.0.1:${port}`,
        wsBase: `ws://127.0.0.1:${port}/ws`,
      };
    }
  } catch {}
}

if (desktopConfig) {
  try {
    contextBridge.exposeInMainWorld('__80DEGREES_CONFIG__', desktopConfig);
  } catch {
    window.__80DEGREES_CONFIG__ = desktopConfig;
  }
}
