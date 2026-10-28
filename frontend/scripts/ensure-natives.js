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

async function downloadAndExtractNativeModule(moduleConfig, targetFile, sourceFile) {
  const url = `https://registry.npmjs.org/@oh-my-pi/pi-natives-${moduleConfig.pkg}/-/pi-natives-${moduleConfig.pkg}-${moduleConfig.version}.tgz`;
  const extractDir = path.dirname(targetFile);
  fs.mkdirSync(extractDir, { recursive: true });
  const archiveName = `pi-native-${moduleConfig.pkg}-${Date.now()}.tgz`;
  const tmpTgz = path.join(extractDir, archiveName);
  console.log(`[Natives] Downloading prebuilt native addon ${moduleConfig.file} from npm registry (${moduleConfig.version})...`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmpTgz, buffer);

    execSync(`tar -xzf "${archiveName}"`, { cwd: extractDir, stdio: 'inherit' });

    const extractedFile = path.join(extractDir, 'package', moduleConfig.file);
    if (fs.existsSync(extractedFile)) {
      fs.copyFileSync(extractedFile, targetFile);
      try { fs.rmSync(path.join(extractDir, 'package'), { recursive: true, force: true }); } catch {}
    }
    try { fs.unlinkSync(tmpTgz); } catch {}
    if (sourceFile && fs.existsSync(targetFile)) {
      try {
        fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
        fs.copyFileSync(targetFile, sourceFile);
      } catch {}
    }
    if (!fs.existsSync(targetFile)) {
      throw new Error(`Target file was not staged: ${targetFile}`);
    }
    console.log(`[Natives] Staged native addon at ${targetFile} and ${sourceFile}`);
    return true;
  } catch (err) {
    try { fs.unlinkSync(tmpTgz); } catch {}
    console.error(`[Natives] Error: Failed to download native addon ${moduleConfig.file}: ${err.message}`);
    throw err;
  }
}

export async function ensureNativeModules(options = {}) {
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
      await downloadAndExtractNativeModule(moduleConfig, targetFile, sourceFile);
    }
  }
}

// Auto-run if executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  await ensureNativeModules();
}
