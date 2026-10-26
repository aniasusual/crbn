import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NATIVE_VERSION = '18.12.3';

const NATIVE_MODULE_CONFIGS = [
  {
    platform: 'darwin',
    file: 'pi_natives.darwin-arm64.node',
    pkg: 'darwin-arm64',
    version: NATIVE_VERSION,
  },
  {
    platform: 'darwin',
    file: 'pi_natives.darwin-x64-baseline.node',
    pkg: 'darwin-x64',
    version: NATIVE_VERSION,
  },
  {
    platform: 'linux',
    file: 'pi_natives.linux-x64-baseline.node',
    pkg: 'linux-x64',
    version: NATIVE_VERSION,
  },
  {
    platform: 'win32',
    file: 'pi_natives.win32-x64-baseline.node',
    pkg: 'win32-x64',
    version: NATIVE_VERSION,
  },
];

function downloadAndExtractNativeModule(moduleConfig, targetFile, sourceFile) {
  const url = `https://registry.npmjs.org/@oh-my-pi/pi-natives-${moduleConfig.pkg}/-/pi-natives-${moduleConfig.pkg}-${moduleConfig.version}.tgz`;
  const tmpTgz = path.join(os.tmpdir(), `pi-native-${moduleConfig.pkg}-${Date.now()}.tgz`);
  console.log(`[Natives] Downloading prebuilt native addon ${moduleConfig.file} from npm registry (${moduleConfig.version})...`);
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
    console.log(`[Natives] Staged native addon at ${targetFile} and ${sourceFile}`);
    return true;
  } catch (err) {
    try { fs.unlinkSync(tmpTgz); } catch {}
    console.warn(`[Natives] Warning: Failed to download native addon ${moduleConfig.file}: ${err.message}`);
    return false;
  }
}

export function ensureNativeModules(options = {}) {
  const nativeDir = path.resolve(__dirname, '../../backend/native');
  const sourceDir = path.resolve(__dirname, '../../pi-harness/packages/natives/native');

  fs.mkdirSync(nativeDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });

  const targetPlatformArg = process.argv.find((a) => a.startsWith('--platform='))?.split('=')[1];
  const currentPlatform = options.platform || targetPlatformArg || process.platform;
  const currentArch = options.arch || process.arch;
  const wantAll = Boolean(options.all || currentPlatform === 'all' || process.argv.includes('--all'));

  for (const moduleConfig of NATIVE_MODULE_CONFIGS) {
    const targetFile = path.join(nativeDir, moduleConfig.file);
    const sourceFile = path.join(sourceDir, moduleConfig.file);

    const isCurrentPlatform = moduleConfig.platform === currentPlatform;
    // On macOS, packaging builds both arm64 and x64, so fetch both for darwin
    const shouldFetch =
      wantAll ||
      (currentPlatform === 'darwin' && moduleConfig.platform === 'darwin') ||
      (isCurrentPlatform &&
        ((currentArch === 'arm64' && moduleConfig.file.includes('arm64')) ||
          (currentArch === 'x64' && moduleConfig.file.includes('x64'))));
    // Check if target file exists and is valid
    const hasTarget = fs.existsSync(targetFile) && fs.statSync(targetFile).size > 1000;
    const hasSource = fs.existsSync(sourceFile) && fs.statSync(sourceFile).size > 1000;

    // Both already exist
    if (hasTarget && hasSource) {
      continue;
    }

    // Target exists but source is missing: copy target -> source
    if (hasTarget && !hasSource) {
      fs.copyFileSync(targetFile, sourceFile);
      console.log(`[Natives] Synced ${moduleConfig.file} -> pi-harness/packages/natives/native/`);
      continue;
    }

    // Source exists but target is missing: copy source -> target
    if (hasSource && !hasTarget) {
      fs.copyFileSync(sourceFile, targetFile);
      console.log(`[Natives] Synced ${moduleConfig.file} -> backend/native/`);
      continue;
    }

    // Neither exists: auto-download if matching target platform/architecture
    if (shouldFetch) {
      downloadAndExtractNativeModule(moduleConfig, targetFile, sourceFile);
    }
  }
}

// Auto-run if executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  ensureNativeModules();
}
