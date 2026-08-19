import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MODEL = 'onnx-community/all-MiniLM-L6-v2-ONNX';
export const DEFAULT_DTYPE = 'q4';

// Keep this manifest aligned with the q4 variant published by the ONNX Community
// model used by Transformers.js. The .onnx_data sidecar is required by ONNX.
const MODEL_FILES = [
  'config.json',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.txt',
  'onnx/model_q4.onnx',
  'onnx/model_q4.onnx_data',
];

// Remote sources, tried in order. The repository copy is preferred because the
// npm package is built from it, so the two always agree; HuggingFace is the
// upstream fallback.
const GITHUB_REF = 'main';
const GITHUB_BASE = `https://raw.githubusercontent.com/haomiao33/local-context-store/${GITHUB_REF}/model`;
const HF_BASE = 'https://huggingface.co/onnx-community/all-MiniLM-L6-v2-ONNX/resolve/main';

const REMOTE_SOURCES = [
  { source: 'github', base: GITHUB_BASE },
  { source: 'huggingface', base: HF_BASE },
];

// The npm package ships the q4 model under <package root>/model (see the
// "files" field in package.json), so a global install already has everything
// needed to run `--semantic` offline.
export function getBundledModelDir() {
  return path.resolve(fileURLToPath(new URL('../model', import.meta.url)));
}

export function isBundledModelAvailable(bundledDir = getBundledModelDir()) {
  if (!bundledDir) return false;
  return MODEL_FILES.every(file => fs.existsSync(path.join(bundledDir, file)));
}

export function getModelBaseDir() {
  if (process.env.LCS_MODEL_DIR) return path.resolve(process.env.LCS_MODEL_DIR);
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'local-context-store', 'models');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'local-context-store', 'models');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'local-context-store', 'models');
}

export function getModelDir({ baseDir = getModelBaseDir(), model = DEFAULT_MODEL } = {}) {
  return path.join(baseDir, ...model.split('/'));
}

export function getModelFiles() {
  return [...MODEL_FILES];
}

export function isModelInstalled(options = {}) {
  const dir = getModelDir(options);
  return MODEL_FILES.every(file => fs.existsSync(path.join(dir, file)));
}

export function modelStatus(options = {}) {
  const dir = getModelDir(options);
  const files = MODEL_FILES.map(file => ({ file, exists: fs.existsSync(path.join(dir, file)) }));
  const bundledDir = options.bundledDir === undefined ? getBundledModelDir() : options.bundledDir;
  return {
    model: options.model ?? DEFAULT_MODEL,
    dtype: DEFAULT_DTYPE,
    dir,
    installed: files.every(file => file.exists),
    files,
    bundled: { dir: bundledDir, available: isBundledModelAvailable(bundledDir) },
  };
}

async function downloadFile(url, destination, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.writeFile(destination, buffer);
}

async function copyModelDirectory(sourceDir, destinationDir) {
  for (const file of MODEL_FILES) {
    const source = path.join(sourceDir, file);
    if (!fs.existsSync(source)) throw new Error(`model source is missing: ${file}`);
    const destination = path.join(destinationDir, file);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(source, destination);
  }
}

async function downloadModelDirectory(destinationDir, fetchImpl) {
  const failures = [];
  for (const { source, base } of REMOTE_SOURCES) {
    try {
      for (const file of MODEL_FILES) {
        await downloadFile(`${base}/${file}`, path.join(destinationDir, file), fetchImpl);
      }
      return source;
    } catch (error) {
      failures.push(`${source}: ${error.message}`);
    }
  }
  throw new Error(`model download failed from every source\n  ${failures.join('\n  ')}`);
}

export async function installModel({
  baseDir = getModelBaseDir(),
  model = DEFAULT_MODEL,
  sourceDir,
  bundledDir,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (model !== DEFAULT_MODEL) throw new Error(`unsupported model: ${model}`);
  const destinationDir = getModelDir({ baseDir, model });
  const bundled = bundledDir === undefined ? getBundledModelDir() : bundledDir;
  await fsp.mkdir(destinationDir, { recursive: true });

  // Explicit --source wins, then the copy shipped in the package, then remote.
  let source;
  if (sourceDir) {
    await copyModelDirectory(path.resolve(sourceDir), destinationDir);
    source = 'source';
  } else if (isBundledModelAvailable(bundled)) {
    await copyModelDirectory(bundled, destinationDir);
    source = 'bundled';
  } else {
    source = await downloadModelDirectory(destinationDir, fetchImpl);
  }

  return { ...modelStatus({ baseDir, model, bundledDir: bundled }), source };
}

// Called before any semantic query: make the model usable, preferring the copy
// that ships with the package so the first `--semantic` run works offline.
export async function ensureModelReady({
  baseDir = getModelBaseDir(),
  model = DEFAULT_MODEL,
  bundledDir,
  allowDownload = true,
  fetchImpl = globalThis.fetch,
} = {}) {
  const bundled = bundledDir === undefined ? getBundledModelDir() : bundledDir;
  if (isModelInstalled({ baseDir, model })) {
    return { ...modelStatus({ baseDir, model, bundledDir: bundled }), source: 'installed' };
  }
  if (isBundledModelAvailable(bundled)) {
    return installModel({ baseDir, model, bundledDir: bundled, fetchImpl });
  }
  if (!allowDownload) {
    throw new Error(`the local ${DEFAULT_DTYPE} embedding model is not available; run \`lcs model install\` to fetch it`);
  }
  return installModel({ baseDir, model, bundledDir: null, fetchImpl });
}

export async function removeModel(options = {}) {
  const dir = getModelDir(options);
  await fsp.rm(dir, { recursive: true, force: true });
  return { ...modelStatus(options), removed: true };
}
