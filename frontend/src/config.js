/**
 * Centralized Application Configuration for 80degrees Frontend.
 * Supports dynamic runtime ports injected by Electron desktop preload,
 * URL query parameters (?backendPort=...), and environment variables.
 */

function resolveDesktopConfig() {
  if (typeof window !== 'undefined') {
    // 1. Injected by Electron preload script via IPC
    if (window.__80DEGREES_CONFIG__) {
      return window.__80DEGREES_CONFIG__;
    }

    // 2. Query parameter passed via loadFile URL
    try {
      if (window.location?.search) {
        const params = new URLSearchParams(window.location.search);
        const queryPort = params.get('backendPort');
        if (queryPort) {
          const portNum = Number(queryPort);
          return {
            port: portNum,
            apiBase: `http://127.0.0.1:${portNum}`,
            wsBase: `ws://127.0.0.1:${portNum}/ws`,
          };
        }
      }
    } catch {}
  }
  return null;
}

const desktopConfig = resolveDesktopConfig();

export const API_BASE_URL =
  desktopConfig?.apiBase ||
  import.meta.env.VITE_BACKEND_HTTP_URL ||
  'http://127.0.0.1:8000';

export const WS_BASE_URL =
  desktopConfig?.wsBase ||
  import.meta.env.VITE_BACKEND_WS_URL ||
  'ws://127.0.0.1:8000/ws';

export const DEV_PORT =
  Number(import.meta.env.VITE_PORT) || 5173;
