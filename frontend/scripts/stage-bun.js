import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ensureNativeModules } from './ensure-natives.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUN_VERSION = '1.4.2';

const TARGET_CONFIGS = {
  'darwin-arm64': {
    assetName: 'bun-darwin-aarch64.zip',
    internalPath: 'bun-darwin-aarch64/bun',
    binaryName: 'bun-arm64',
  },
  'darwin-x64': {
    assetName: 'bun-darwin-x64.zip',
    internalPath: 'bun-darwin-x64/bun',
    binaryName: 'bun-x64',
  },
  'linux-x64': {
    assetName: 'bun-linux-x64.zip',
    internalPath: 'bun-linux-x64/bun',
    binaryName: 'bun',
  },
  'win32-x64': {
    assetName: 'bun-windows-x64.zip',
    internalPath: 'bun-windows-x64/bun.exe',
    binaryName: 'bun.exe',
  },
};

function findLocalBunBinary() {
  const binaryName = process.platform === 'win32' ? 'bun.exe' : 'bun';

  // 1. Check which / where command
  try {
    const cmd = process.platform === 'win32' ? 'where bun.exe' : 'which bun';
    const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    const firstLine = output.split(/\r?\n/)[0]?.trim();
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine;
    }
  } catch {}

  // 2. Check known directories
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

  return null;
}

function ensureIcons() {
  const buildDir = path.join(__dirname, '../build');
  const icnsPath = path.join(buildDir, 'icon.icns');
  const pngPath = path.join(buildDir, 'icon.png');
  const sourceIcon = path.join(__dirname, '../electron/icon.png');

  if (fs.existsSync(icnsPath) && fs.existsSync(pngPath)) return;
  if (!fs.existsSync(sourceIcon)) return;

  fs.mkdirSync(buildDir, { recursive: true });
  if (!fs.existsSync(pngPath)) {
    fs.copyFileSync(sourceIcon, pngPath);
  }

  if (process.platform === 'darwin' && !fs.existsSync(icnsPath)) {
    try {
      const iconsetDir = path.join(buildDir, 'icon.iconset');
      fs.mkdirSync(iconsetDir, { recursive: true });
      const sizes = [16, 32, 64, 128, 256, 512];
      for (const s of sizes) {
        execSync(`sips -z ${s} ${s} "${sourceIcon}" --out "${path.join(iconsetDir, `icon_${s}x${s}.png`)}"`, {
          stdio: 'ignore',
        });
        const s2 = s * 2;
        if (s2 <= 1024) {
          execSync(
            `sips -z ${s2} ${s2} "${sourceIcon}" --out "${path.join(iconsetDir, `icon_${s}x${s}@2x.png`)}"`,
            { stdio: 'ignore' }
          );
        }
      }
      execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, { stdio: 'ignore' });
      fs.rmSync(iconsetDir, { recursive: true, force: true });
      console.log(`[Stage] Successfully generated ${icnsPath}`);
    } catch (err) {
      console.warn('[Stage] Icon generation warning:', err.message);
    }
  }
}


async function downloadAndExtractBun(targetKey, targetDir) {
  const config = TARGET_CONFIGS[targetKey];
  if (!config) {
    throw new Error(`Unknown target config key: ${targetKey}`);
  }

  const destinationPath = path.join(targetDir, config.binaryName);
  if (fs.existsSync(destinationPath) && fs.statSync(destinationPath).size > 1000000) {
    return destinationPath;
  }

  // If running on matching host, copy local Bun if available
  const currentHostKey = `${process.platform}-${process.arch === 'x64' ? 'x64' : 'arm64'}`;
  const localBun = findLocalBunBinary();
  if (currentHostKey === targetKey && localBun) {
    console.log(`[Stage] Copying host Bun binary (${localBun}) to ${destinationPath}...`);
    fs.copyFileSync(localBun, destinationPath);
    if (process.platform !== 'win32') {
      try { fs.chmodSync(destinationPath, 0o755); } catch {}
    }
    return destinationPath;
  }

  const downloadUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${config.assetName}`;
  const tmpZipName = `bun-stage-${targetKey}-${Date.now()}.zip`;
  const tmpZip = path.join(targetDir, tmpZipName);

  console.log(`[Stage] Downloading standalone Bun from ${downloadUrl}...`);
  try {
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmpZip, buffer);

    if (process.platform === 'win32') {
      execSync(`tar -xf "${tmpZipName}"`, { cwd: targetDir, stdio: 'inherit' });
      const nested = path.join(targetDir, 'bun-windows-x64', 'bun.exe');
      if (fs.existsSync(nested) && !fs.existsSync(destinationPath)) {
        fs.copyFileSync(nested, destinationPath);
      }
    } else {
      execSync(`unzip -p "${tmpZipName}" "${config.internalPath}" > "${destinationPath}"`, { cwd: targetDir, stdio: 'inherit' });
      fs.chmodSync(destinationPath, 0o755);
    }
    try { fs.unlinkSync(tmpZip); } catch {}
    console.log(`[Stage] Staged ${config.binaryName} successfully at ${destinationPath}`);
    return destinationPath;
  } catch (err) {
    try { fs.unlinkSync(tmpZip); } catch {}
    throw new Error(`Failed to download and stage Bun for ${targetKey}: ${err.message}`);
  }
}

function ensureBunShims(targetDir) {
  console.log('[Stage] Generating node, npm, and npx shims redirecting to Bun...');

  const posixShimHeader = '#!/bin/sh\n' +
    'DIR="$(cd "$(dirname "$0")" && pwd)"\n' +
    'if [ -x "$DIR/bun" ]; then\n' +
    '  BUN_BIN="$DIR/bun"\n' +
    'elif [ -x "$DIR/bun-arm64" ] && [ "$(uname -m)" = "arm64" ]; then\n' +
    '  BUN_BIN="$DIR/bun-arm64"\n' +
    'elif [ -x "$DIR/bun-x64" ]; then\n' +
    '  BUN_BIN="$DIR/bun-x64"\n' +
    'elif command -v bun >/dev/null 2>&1; then\n' +
    '  BUN_BIN="bun"\n' +
    'else\n' +
    '  echo "[80degrees] Error: Bundled Bun binary not found for shim" >&2\n' +
    '  exit 1\n' +
    'fi\n';

  const posixShims = {
    node: posixShimHeader + 'exec "$BUN_BIN" "$@"\n',
    npm: posixShimHeader +
      'case "$1" in\n' +
      '  -v|--version)\n' +
      '    exec "$BUN_BIN" --version\n' +
      '    ;;\n' +
      '  run)\n' +
      '    shift\n' +
      '    exec "$BUN_BIN" run "$@"\n' +
      '    ;;\n' +
      '  i|install)\n' +
      '    shift\n' +
      '    exec "$BUN_BIN" install "$@"\n' +
      '    ;;\n' +
      '  add)\n' +
      '    shift\n' +
      '    exec "$BUN_BIN" add "$@"\n' +
      '    ;;\n' +
      '  rm|remove|uninstall)\n' +
      '    shift\n' +
      '    exec "$BUN_BIN" remove "$@"\n' +
      '    ;;\n' +
      '  test)\n' +
      '    shift\n' +
      '    exec "$BUN_BIN" test "$@"\n' +
      '    ;;\n' +
      '  *)\n' +
      '    exec "$BUN_BIN" "$@"\n' +
      '    ;;\n' +
      'esac\n',
    npx: posixShimHeader +
      'case "$1" in\n' +
      '  -v|--version)\n' +
      '    exec "$BUN_BIN" --version\n' +
      '    ;;\n' +
      '  *)\n' +
      '    exec "$BUN_BIN" x "$@"\n' +
      '    ;;\n' +
      'esac\n',
  };

  for (const [name, content] of Object.entries(posixShims)) {
    const filePath = path.join(targetDir, name);
    fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o755 });
  }

  const winShims = {
    'node.cmd':
      '@echo off\r\n' +
      'set "BUN_BIN=%~dp0\\bun.exe"\r\n' +
      'if not exist "%BUN_BIN%" set "BUN_BIN=bun.exe"\r\n' +
      '"%BUN_BIN%" %*\r\n',
    'npm.cmd':
      '@echo off\r\n' +
      'set "BUN_BIN=%~dp0\\bun.exe"\r\n' +
      'if not exist "%BUN_BIN%" set "BUN_BIN=bun.exe"\r\n' +
      'if "%~1"=="-v" ("%BUN_BIN%" --version & exit /b %errorlevel%)\r\n' +
      'if "%~1"=="--version" ("%BUN_BIN%" --version & exit /b %errorlevel%)\r\n' +
      'if "%~1"=="run" (shift & "%BUN_BIN%" run %1 %2 %3 %4 %5 %6 %7 %8 %9 & exit /b %errorlevel%)\r\n' +
      'if "%~1"=="i" (shift & "%BUN_BIN%" install %1 %2 %3 %4 %5 %6 %7 %8 %9 & exit /b %errorlevel%)\r\n' +
      'if "%~1"=="install" (shift & "%BUN_BIN%" install %1 %2 %3 %4 %5 %6 %7 %8 %9 & exit /b %errorlevel%)\r\n' +
      'if "%~1"=="add" (shift & "%BUN_BIN%" add %1 %2 %3 %4 %5 %6 %7 %8 %9 & exit /b %errorlevel%)\r\n' +
      'if "%~1"=="rm" (shift & "%BUN_BIN%" remove %1 %2 %3 %4 %5 %6 %7 %8 %9 & exit /b %errorlevel%)\r\n' +
      'if "%~1"=="remove" (shift & "%BUN_BIN%" remove %1 %2 %3 %4 %5 %6 %7 %8 %9 & exit /b %errorlevel%)\r\n' +
      'if "%~1"=="uninstall" (shift & "%BUN_BIN%" remove %1 %2 %3 %4 %5 %6 %7 %8 %9 & exit /b %errorlevel%)\r\n' +
      'if "%~1"=="test" (shift & "%BUN_BIN%" test %1 %2 %3 %4 %5 %6 %7 %8 %9 & exit /b %errorlevel%)\r\n' +
      '"%BUN_BIN%" %*\r\n',
    'npx.cmd':
      '@echo off\r\n' +
      'set "BUN_BIN=%~dp0\\bun.exe"\r\n' +
      'if not exist "%BUN_BIN%" set "BUN_BIN=bun.exe"\r\n' +
      'if "%~1"=="-v" ("%BUN_BIN%" --version & exit /b %errorlevel%)\r\n' +
      'if "%~1"=="--version" ("%BUN_BIN%" --version & exit /b %errorlevel%)\r\n' +
      '"%BUN_BIN%" x %*\r\n',
  };

  for (const [name, content] of Object.entries(winShims)) {
    const filePath = path.join(targetDir, name);
    fs.writeFileSync(filePath, content, { encoding: 'utf8' });
  }
}

async function stageBun() {
  ensureIcons();

  const platformArg = process.argv.find((a) => a.startsWith('--platform='))?.split('=')[1];
  const targetArg = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1];
  const effectivePlatform = platformArg || (targetArg ? targetArg.split('-')[0] : process.platform);

  await ensureNativeModules({ platform: effectivePlatform, all: effectivePlatform === 'all' });

  const targetDir = path.join(__dirname, '../resources/bin');
  fs.mkdirSync(targetDir, { recursive: true });

  if (effectivePlatform === 'all') {
    await downloadAndExtractBun('darwin-arm64', targetDir);
    await downloadAndExtractBun('darwin-x64', targetDir);
    await downloadAndExtractBun('win32-x64', targetDir);
    await downloadAndExtractBun('linux-x64', targetDir);
  } else if (targetArg && TARGET_CONFIGS[targetArg]) {
    await downloadAndExtractBun(targetArg, targetDir);
    if (targetArg.startsWith('darwin')) {
      const hostArchBinary = path.join(targetDir, TARGET_CONFIGS[targetArg].binaryName);
      const defaultBun = path.join(targetDir, 'bun');
      if (fs.existsSync(hostArchBinary)) {
        try { fs.unlinkSync(defaultBun); } catch {}
        fs.copyFileSync(hostArchBinary, defaultBun);
        try { fs.chmodSync(defaultBun, 0o755); } catch {}
      }
    }
  } else if (effectivePlatform === 'darwin') {
    await downloadAndExtractBun('darwin-arm64', targetDir);
    await downloadAndExtractBun('darwin-x64', targetDir);

    const hostBinaryName = process.arch === 'arm64' ? 'bun-arm64' : 'bun-x64';
    const hostArchBinary = path.join(targetDir, hostBinaryName);
    const defaultBun = path.join(targetDir, 'bun');

    if (fs.existsSync(hostArchBinary)) {
      if (fs.existsSync(defaultBun)) {
        try { fs.unlinkSync(defaultBun); } catch {}
      }
      fs.copyFileSync(hostArchBinary, defaultBun);
      try { fs.chmodSync(defaultBun, 0o755); } catch {}
      console.log(`[Stage] Staged default 'bun' -> ${hostBinaryName}`);
    }
  } else if (effectivePlatform === 'win32') {
    await downloadAndExtractBun('win32-x64', targetDir);
  } else if (effectivePlatform === 'linux') {
    await downloadAndExtractBun('linux-x64', targetDir);
  } else {
    console.warn(`[Stage] Unknown platform target: ${effectivePlatform}, staging current host.`);
    await downloadAndExtractBun(`darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}`, targetDir);
  }

  ensureBunShims(targetDir);
  console.log('[Stage] Staging complete for release.');
}

await stageBun();
