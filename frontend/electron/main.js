import { app, BrowserWindow, shell, dialog, Menu, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.setName('80degrees');

// Determine development vs packaged production mode strictly from Electron
const isDev = !app.isPackaged;
const devPort = process.env.VITE_PORT || 5173;
const devHost = process.env.VITE_HOST || 'localhost';
const devUrl = process.env.ELECTRON_DEV_URL || `http://${devHost}:${devPort}`;

let mainWindow = null;
let backendProcess = null;
let activeBackendPort = 8000;

// Test if an address and port can be bound or if it is currently occupied
function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

// Locate an available loopback port, attempting preferredPort first
async function findAvailablePort(preferredPort = 8000) {
  const preferredFree = await isPortAvailable(preferredPort);
  if (preferredFree) {
    return preferredPort;
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => reject(err));
    server.once('listening', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((closeErr) => {
        if (closeErr) return reject(closeErr);
        resolve(port);
      });
    });
    server.listen(0, '127.0.0.1');
  });
}

// Find working Bun binary for the current operating system and architecture
function findBunBinary() {
  const binaryName = process.platform === 'win32' ? 'bun.exe' : 'bun';

  // 1. Packaged production: inspect inside process.resourcesPath/bin
  if (app.isPackaged) {
    // Primary on macOS: arch-specific binary first (bun-arm64 or bun-x64) to prevent arch mismatch
    if (process.platform === 'darwin') {
      const archBin = path.join(process.resourcesPath, 'bin', `bun-${process.arch}`);
      if (fs.existsSync(archBin)) {
        try { fs.chmodSync(archBin, 0o755); } catch {}
        return archBin;
      }
    }

    // Standard binary name
    const bundledDefault = path.join(process.resourcesPath, 'bin', binaryName);
    if (fs.existsSync(bundledDefault)) {
      if (process.platform !== 'win32') {
        try { fs.chmodSync(bundledDefault, 0o755); } catch {}
      }
      return bundledDefault;
    }
  }

  // 2. Local development: inspect inside resources/bin
  if (process.platform === 'darwin') {
    const localArch = path.join(__dirname, '../resources/bin', `bun-${process.arch}`);
    if (fs.existsSync(localArch)) {
      return localArch;
    }
  }
  const localDefault = path.join(__dirname, '../resources/bin', binaryName);
  if (fs.existsSync(localDefault)) {
    return localDefault;
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

  return binaryName;
}

// Probe backend health endpoint
async function checkBackendHealth(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return body?.status === 'ok';
  } catch {
    return false;
  }
}

// Start backend Bun subprocess and wait for health handshake
async function startBackend() {
  // In development mode, check if a backend server is already running on port 8000
  if (isDev) {
    const devHealth = await checkBackendHealth(8000);
    if (devHealth) {
      console.log('[Electron] Attached to existing dev backend on port 8000.');
      activeBackendPort = 8000;
      return;
    }
  }

  // Locate backend distribution and script
  let backendDir = path.join(__dirname, '../../backend');
  if (app.isPackaged) {
    const packagedBackend = path.join(process.resourcesPath, 'backend');
    if (fs.existsSync(packagedBackend)) {
      backendDir = packagedBackend;
    }
  }

  if (isDev) {
    try {
      const { ensureNativeModules } = await import('../scripts/ensure-natives.js');
      ensureNativeModules();
    } catch (err) {
      console.warn('[Electron] Failed to auto-ensure native modules:', err.message);
    }
  }

  const scriptToRun = fs.existsSync(path.join(backendDir, 'dist/index.js'))
    ? path.join(backendDir, 'dist/index.js')
    : path.join(backendDir, 'src/index.ts');

  // Allocate safe port
  const targetPort = await findAvailablePort(8000);
  activeBackendPort = targetPort;

  const bunBinary = findBunBinary();
  console.log(`[Electron] Launching backend on port ${targetPort} using ${bunBinary}...`);

  // Ensure writable working directory and log location
  const userDataDir = app.getPath('userData');
  const runtimeDir = path.join(userDataDir, 'backend_runtime');
  const logsDir = path.join(userDataDir, 'logs');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const logFilePath = path.join(logsDir, 'backend.log');
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

  // Compose clean augmented PATH
  const bunBinDir = path.dirname(bunBinary);
  const home = os.homedir();
  const extraPaths = [
    bunBinDir,
    path.join(home, '.bun', 'bin'),
    path.join(userDataDir, 'bin', 'mingit', 'cmd'),
    path.join(userDataDir, 'bin', 'mingit', 'usr', 'bin'),
    path.join(userDataDir, 'bin', 'mingit', 'bin'),
    path.join(userDataDir, 'bin', 'git', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd' : '',
    process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin' : '',
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Git\\cmd' : '',
    process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd') : '',
  ].filter(Boolean);

  const existingPathParts = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const combinedPath = Array.from(new Set([...extraPaths, ...existingPathParts])).join(path.delimiter);

  const backendEnv = {
    ...process.env,
    PATH: combinedPath,
    PORT: String(targetPort),
    BACKEND_PORT: String(targetPort),
    HOST: '127.0.0.1',
    BACKEND_HOST: '127.0.0.1',
    NODE_ENV: isDev ? 'development' : 'production',
    TEMPLATES_DIR: path.join(backendDir, 'templates'),
    RESOURCES_PATH: process.resourcesPath || path.join(__dirname, '..'),
    USER_DATA_DIR: userDataDir,
    PI_NATIVES_DIR: path.join(backendDir, 'native'),
  };

  try {
    backendProcess = spawn(bunBinary, ['run', scriptToRun], {
      cwd: runtimeDir,
      env: backendEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    backendProcess.stdout?.on('data', (data) => {
      const line = data.toString();
      logStream.write(line);
      console.log(`[Backend] ${line.trim()}`);
    });

    backendProcess.stderr?.on('data', (data) => {
      const line = data.toString();
      logStream.write(line);
      console.error(`[Backend ERR] ${line.trim()}`);
    });

    backendProcess.on('error', (err) => {
      console.error('[Electron] Failed to spawn backend process:', err);
      dialog.showErrorBox(
        'Backend Startup Failed',
        `Could not start the backend process (${bunBinary}):\n\n${err.message}\n\nLog file: ${logFilePath}`
      );
    });

    backendProcess.on('exit', (code, signal) => {
      console.log(`[Electron] Backend process exited (code: ${code}, signal: ${signal})`);
      backendProcess = null;
    });

    // Wait up to 15 seconds for backend to pass health check
    const deadline = Date.now() + 15000;
    let isReady = false;

    while (Date.now() < deadline) {
      if (await checkBackendHealth(targetPort)) {
        isReady = true;
        console.log(`[Electron] Backend server is confirmed healthy on port ${targetPort}.`);
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    if (!isReady && backendProcess) {
      console.warn(`[Electron] Backend did not respond on port ${targetPort} within 15 seconds.`);
    }
  } catch (err) {
    console.error('[Electron] Exception launching backend:', err);
    dialog.showErrorBox('Backend Initialization Error', `${err.message}\n\nLog file: ${logFilePath}`);
  }
}

// Cleanly kill backend child process tree
function stopBackend() {
  if (backendProcess) {
    console.log('[Electron] Terminating backend process...');
    const pid = backendProcess.pid;
    const proc = backendProcess;
    backendProcess = null;
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
      } else {
        proc.kill('SIGTERM');
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {}
        // Schedule SIGKILL fallback if not dead after 2s
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {}
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {}
        }, 2000);
      }
    } catch {}
  }
}

// Provide desktop connection config to renderer via synchronous IPC
ipcMain.on('get-desktop-config', (event) => {
  event.returnValue = {
    port: activeBackendPort,
    apiBase: `http://127.0.0.1:${activeBackendPort}`,
    wsBase: `ws://127.0.0.1:${activeBackendPort}/ws`,
    isPackaged: app.isPackaged,
  };
});
ipcMain.handle('select-directory', async () => {
  const targetWindow = mainWindow || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const options = {
    title: 'Open Existing Project Folder in crbn',
    properties: ['openDirectory', 'createDirectory'],
  };
  const result = targetWindow
    ? await dialog.showOpenDialog(targetWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

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
  const preloadPath = path.join(__dirname, 'preload.cjs');

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
      preload: fs.existsSync(preloadPath) ? preloadPath : undefined,
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

  // Prevent main window from navigating away from the app
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
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      query: { backendPort: String(activeBackendPort) },
    });
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
