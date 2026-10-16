import { app, BrowserWindow, shell, dialog, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load optional local .env configuration in development without external dependencies
try {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {}
// Determine if we are in development mode
const isDev = process.env.NODE_ENV === 'development';

const devPort = process.env.VITE_PORT || 5173;
const devHost = process.env.VITE_HOST || 'localhost';
const devUrl = process.env.ELECTRON_DEV_URL || `http://${devHost}:${devPort}`;

let mainWindow = null;
let backendProcess = null;

// Find working bun binary (prioritizing bundled sidecar binary inside app)
function findBunBinary() {
  const binaryName = process.platform === 'win32' ? 'bun.exe' : 'bun';

  // 1. Packaged production: inside process.resourcesPath/bin
  if (app.isPackaged) {
    if (process.platform === 'darwin') {
      const archBin = path.join(process.resourcesPath, 'bin', `bun-${process.arch}`);
      if (fs.existsSync(archBin)) {
        try { fs.chmodSync(archBin, 0o755); } catch {}
        console.log(`[Electron] Using bundled arch Bun (${process.arch}): ${archBin}`);
        return archBin;
      }
    }

    const bundledBin = path.join(process.resourcesPath, 'bin', binaryName);
    if (fs.existsSync(bundledBin)) {
      try {
        if (process.platform !== 'win32') fs.chmodSync(bundledBin, 0o755);
      } catch {}
      console.log(`[Electron] Using bundled sidecar Bun: ${bundledBin}`);
      return bundledBin;
    }
  }
  // 2. Local development: inside resources/bin
  if (process.platform === 'darwin') {
    const localArch = path.join(__dirname, '../resources/bin', `bun-${process.arch}`);
    if (fs.existsSync(localArch)) {
      console.log(`[Electron] Using local arch Bun (${process.arch}): ${localArch}`);
      return localArch;
    }
  }
  const localBundled = path.join(__dirname, '../resources/bin', binaryName);
  if (fs.existsSync(localBundled)) {
    console.log(`[Electron] Using local resources Bun: ${localBundled}`);
    return localBundled;
  }

  // 3. User system paths fallback
  const home = os.homedir();
  const candidates = [
    process.env.BUN_PATH,
    path.join(home, '.bun', 'bin', binaryName),
    '/usr/local/bin/bun',
    '/opt/homebrew/bin/bun',
    '/usr/bin/bun',
  ];

  if (process.platform === 'win32' && process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, '.bun', 'bin', 'bun.exe'));
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'bun';
}

// Check if backend HTTP service is already listening
async function isBackendRunning(port = 8000) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/system/models-and-hardware`, {
      signal: AbortSignal.timeout(1200),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Start backend Bun subprocess if not already running
async function startBackend() {
  const alreadyRunning = await isBackendRunning(8000);
  if (alreadyRunning) {
    console.log('[Electron] Backend server is already running on port 8000.');
    return;
  }

  // Locate backend directory (packaged vs local development)
  let backendDir = path.join(__dirname, '../../backend');
  if (app.isPackaged) {
    const packagedBackend = path.join(process.resourcesPath, 'backend');
    if (fs.existsSync(packagedBackend)) {
      backendDir = packagedBackend;
    }
  }

  const bunBinary = findBunBinary();
  console.log(`[Electron] Launching backend using ${bunBinary} in ${backendDir}...`);

  const scriptToRun = fs.existsSync(path.join(backendDir, 'dist/index.js'))
    ? 'dist/index.js'
    : 'src/index.ts';

  try {
    backendProcess = spawn(bunBinary, ['run', scriptToRun], {
      cwd: backendDir,
      env: {
        ...process.env,
        PATH: [
          path.dirname(bunBinary),
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/usr/bin',
          '/bin',
          path.join(os.homedir(), '.bun/bin'),
          process.env.PATH || '',
        ].filter(Boolean).join(path.delimiter),
        PORT: '8000',
        NODE_ENV: isDev ? 'development' : 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProcess.stdout?.on('data', (data) => {
      console.log(`[Backend] ${data.toString().trim()}`);
    });

    backendProcess.stderr?.on('data', (data) => {
      console.error(`[Backend ERR] ${data.toString().trim()}`);
    });

    backendProcess.on('error', (err) => {
      console.error('[Electron] Failed to spawn backend process:', err);
      dialog.showErrorBox(
        'Backend Startup Failed',
        `Could not start the backend process with Bun (${bunBinary}):\n\n${err.message}\n\nPlease ensure Bun is installed (https://bun.sh).`
      );
    });

    backendProcess.on('exit', (code, signal) => {
      console.log(`[Electron] Backend process exited (code: ${code}, signal: ${signal})`);
      backendProcess = null;
    });

    // Wait up to 6 seconds for backend HTTP server to be ready before proceeding
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (await isBackendRunning(8000)) {
        console.log('[Electron] Backend server is confirmed ready on port 8000.');
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  } catch (err) {
    console.error('[Electron] Exception launching backend:', err);
  }
}

// Cleanly kill backend child process
function stopBackend() {
  if (backendProcess) {
    console.log('[Electron] Terminating backend process...');
    try {
      backendProcess.kill('SIGTERM');
    } catch {}
    backendProcess = null;
  }
}

function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
            ]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' },
            ]
          : [{ role: 'close' }]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  const iconCandidates = [
    path.join(__dirname, '../build/icon.png'),
    path.join(__dirname, 'icon.png'),
    path.join(process.resourcesPath, 'build/icon.png'),
  ];
  const iconPath = iconCandidates.find((p) => fs.existsSync(p));
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: '80degrees',
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
    },
    show: false,
    backgroundColor: '#000000',
  });

  // Open external URLs in default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Prevent the main window from navigating away from the app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      if (!isDev || !url.startsWith(devUrl)) {
        event.preventDefault();
        shell.openExternal(url);
      }
    }
  });
  if (isDev) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  setupApplicationMenu();
  await startBackend();
  createWindow();

  app.on('activate', () => {
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

app.on('before-quit', stopBackend);
app.on('will-quit', stopBackend);
process.on('SIGINT', () => {
  stopBackend();
  app.quit();
});
process.on('SIGTERM', () => {
  stopBackend();
  app.quit();
});
