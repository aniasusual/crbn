/**
 * Centralized Application Configuration for Lowkey Frontend.
 * Reads environment variables defined with VITE_ prefix.
 */

export const API_BASE_URL =
  import.meta.env.VITE_BACKEND_HTTP_URL || 'http://127.0.0.1:8000';

export const WS_BASE_URL =
  import.meta.env.VITE_BACKEND_WS_URL || 'ws://127.0.0.1:8000/ws';

export const DEV_PORT =
  Number(import.meta.env.VITE_PORT) || 5173;
