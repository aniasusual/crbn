import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load frontend .env configuration
dotenv.config({ path: path.join(__dirname, '../.env') });

// Determine if we are in development mode
const isDev = process.env.NODE_ENV === 'development';

const devPort = process.env.VITE_PORT || 5173;
const devHost = process.env.VITE_HOST || 'localhost';
const devUrl = process.env.ELECTRON_DEV_URL || `http://${devHost}:${devPort}`;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // For simplicity we are allowing nodeIntegration, though in real production contextIsolation should be true
      webviewTag: true, // To support webview if needed, or we just use iframe
    },
    show: false, // Don't show until ready-to-show
  });

  // Open all external URLs in the user's default web browser (Chrome/Safari/etc.)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  if (isDev) {
    // Load Vite dev server URL from environment
    mainWindow.loadURL(devUrl);
    // Open the DevTools.
    mainWindow.webContents.openDevTools();
  } else {
    // Load the index.html of the app.
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Show window smoothly when it's ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
