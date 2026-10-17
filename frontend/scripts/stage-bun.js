import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

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

const NATIVE_MODULE_CONFIGS = [
  {
    platform: 'darwin',
    file: 'pi_natives.darwin-arm64.node',
    pkg: 'darwin-arm64',
    version: '18.4.10',
  },
  {
    platform: 'darwin',
    file: 'pi_natives.darwin-x64-baseline.node',
    pkg: 'darwin-x64',
    version: '18.4.10',
  },
  {
    platform: 'linux',
    file: 'pi_natives.linux-x64-baseline.node',
    pkg: 'linux-x64',
    version: '18.4.10',
  },
  {
    platform: 'win32',
    file: 'pi_natives.win32-x64-baseline.node',
    pkg: 'win32-x64',
    version: '18.4.10',
  },
];

function downloadAndExtractNativeModule(moduleConfig, targetFile, sourceFile) {
  const url = `https://registry.npmjs.org/@oh-my-pi/pi-natives-${moduleConfig.pkg}/-/pi-natives-${moduleConfig.pkg}-${moduleConfig.version}.tgz`;
  const tmpTgz = path.join(os.tmpdir(), `pi-native-${moduleConfig.pkg}-${Date.now()}.tgz`);
  console.log(`[Stage] Downloading native module ${moduleConfig.file} from ${url}...`);
  try {
    execSync(`curl -fsSL "${url}" -o "${tmpTgz}"`, { stdio: 'inherit' });
    const extractDir = path.dirname(targetFile);
    fs.mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xzf "${tmpTgz}" -C "${extractDir}" --strip-components=1 "package/${moduleConfig.file}"`, {
      stdio: 'inherit',
    });
    try { fs.unlinkSync(tmpTgz); } catch {}
    if (sourceFile && fs.existsSync(targetFile)) {
      try {
        fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
        fs.copyFileSync(targetFile, sourceFile);
      } catch {}
    }
    console.log(`[Stage] Successfully staged native module at ${targetFile}`);
  } catch (err) {
    try { fs.unlinkSync(tmpTgz); } catch {}
    console.warn(`[Stage] Warning: Failed to download native module ${moduleConfig.file}: ${err.message}`);
  }
}

function ensureNativeModules() {
  const nativeDir = path.join(__dirname, '../../backend/native');
  const sourceDir = path.join(__dirname, '../../pi-harness/packages/natives/native');
  fs.mkdirSync(nativeDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });

  const currentPlatform = process.platform;

  for (const moduleConfig of NATIVE_MODULE_CONFIGS) {
    // Primary: Stage modules matching current build platform
    const targetFile = path.join(nativeDir, moduleConfig.file);
    const sourceFile = path.join(sourceDir, moduleConfig.file);

    if (moduleConfig.platform !== currentPlatform) {
      if (!fs.existsSync(targetFile) && fs.existsSync(sourceFile) && fs.statSync(sourceFile).size > 1000) {
        fs.copyFileSync(sourceFile, targetFile);
      }
      continue;
    }

    if (fs.existsSync(targetFile) && fs.statSync(targetFile).size > 1000) {
      continue;
    }

    if (fs.existsSync(sourceFile) && fs.statSync(sourceFile).size > 1000) {
      fs.copyFileSync(sourceFile, targetFile);
      console.log(`[Stage] Copied ${moduleConfig.file} to backend/native/`);
      continue;
    }

    // Missing from disk in fresh CI checkout: fetch from registry
    downloadAndExtractNativeModule(moduleConfig, targetFile, sourceFile);
  }
}

function downloadAndExtractBun(targetKey, targetDir) {
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
  const tmpZip = path.join(os.tmpdir(), `bun-stage-${targetKey}-${Date.now()}.zip`);

  console.log(`[Stage] Downloading standalone Bun from ${downloadUrl}...`);
  try {
    execSync(`curl -fsSL "${downloadUrl}" -o "${tmpZip}"`, { stdio: 'inherit' });
    if (process.platform === 'win32') {
      execSync(`tar -xf "${tmpZip}" -C "${targetDir}"`, { stdio: 'inherit' });
      const nested = path.join(targetDir, 'bun-windows-x64', 'bun.exe');
      if (fs.existsSync(nested) && !fs.existsSync(destinationPath)) {
        fs.copyFileSync(nested, destinationPath);
      }
    } else {
      execSync(`unzip -p "${tmpZip}" "${config.internalPath}" > "${destinationPath}"`, { stdio: 'inherit' });
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

function stageBun() {
  ensureIcons();
  ensureNativeModules();

  const targetDir = path.join(__dirname, '../resources/bin');
  fs.mkdirSync(targetDir, { recursive: true });

  const platform = process.platform;

  if (platform === 'darwin') {
    // Stage both arm64 and x64 macOS binaries for universal/cross builds
    downloadAndExtractBun('darwin-arm64', targetDir);
    downloadAndExtractBun('darwin-x64', targetDir);

    // Provide default 'bun' pointing to current host architecture
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
  } else if (platform === 'win32') {
    downloadAndExtractBun('win32-x64', targetDir);
  } else {
    downloadAndExtractBun('linux-x64', targetDir);
  }

  console.log('[Stage] Staging complete for release.');
}

stageBun();
