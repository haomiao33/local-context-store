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

// The npm package ships the q4 model under <package root>/model, laid out as
// <base>/<org>/<name>/ so transformers.js can load it straight out of the
// package. A global install is therefore ready for `--semantic` with no
// install step, no download, and no second copy on disk.
export function getBundledModelBaseDir() {
  return path.resolve(fileURLToPath(new URL('../model', import.meta.url)));
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

export function isModelAvailable(options = {}) {
  if (!options.baseDir) return false;
  const dir = getModelDir(options);
  return MODEL_FILES.every(file => fs.existsSync(path.join(dir, file)));
}

// The user data directory wins so that `model install --source` and
// LCS_MODEL_DIR stay effective overrides; the packaged copy is the fallback.
export function resolveModelBaseDir({
  baseDir = getModelBaseDir(),
  bundledBaseDir = getBundledModelBaseDir(),
  model = DEFAULT_MODEL,
} = {}) {
  if (isModelAvailable({ baseDir, model })) return baseDir;
  if (isModelAvailable({ baseDir: bundledBaseDir, model })) return bundledBaseDir;
  return null;
}

export function modelStatus(options = {}) {
  const model = options.model ?? DEFAULT_MODEL;
  const baseDir = options.baseDir ?? getModelBaseDir();
  const bundledBaseDir = options.bundledBaseDir === undefined ? getBundledModelBaseDir() : options.bundledBaseDir;
  const resolved = resolveModelBaseDir({ baseDir, bundledBaseDir, model });
  const resolvedFrom = resolved === null ? null : (resolved === baseDir ? 'user' : 'packaged');
  // Report the files of whichever copy will actually be loaded; with none
  // available, report the user data directory so the paths stay actionable.
  const dir = getModelDir({ baseDir: resolved ?? baseDir, model });
  return {
    model,
    dtype: DEFAULT_DTYPE,
    dir,
    baseDir,
    bundledBaseDir,
    available: resolved !== null,
    resolvedFrom,
    files: MODEL_FILES.map(file => ({ file, exists: fs.existsSync(path.join(dir, file)) })),
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

// Only needed when the packaged model is absent — a git checkout without the
// model/ directory, or a deliberate override of the packaged copy.
export async function installModel({
  baseDir = getModelBaseDir(),
  model = DEFAULT_MODEL,
  sourceDir,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (model !== DEFAULT_MODEL) throw new Error(`unsupported model: ${model}`);
  const destinationDir = getModelDir({ baseDir, model });
  await fsp.mkdir(destinationDir, { recursive: true });

  const source = sourceDir
    ? (await copyModelDirectory(path.resolve(sourceDir), destinationDir), 'source')
    : await downloadModelDirectory(destinationDir, fetchImpl);

  return { ...modelStatus({ baseDir, model }), source, baseDir };
}

// Called before any semantic query. Resolving is normally enough: the packaged
// model is loaded where it lies, so nothing is copied and nothing is fetched.
export async function ensureModelReady({
  baseDir = getModelBaseDir(),
  model = DEFAULT_MODEL,
  bundledBaseDir,
  allowDownload = true,
  fetchImpl = globalThis.fetch,
} = {}) {
  const bundled = bundledBaseDir === undefined ? getBundledModelBaseDir() : bundledBaseDir;
  const resolved = resolveModelBaseDir({ baseDir, bundledBaseDir: bundled, model });
  if (resolved !== null) {
    return {
      ...modelStatus({ baseDir, model, bundledBaseDir: bundled }),
      source: resolved === baseDir ? 'user' : 'packaged',
      baseDir: resolved,
    };
  }
  if (!allowDownload) {
    throw new Error(`the ${DEFAULT_DTYPE} embedding model is not available; run \`lcs model install\` to fetch it`);
  }
  return installModel({ baseDir, model, fetchImpl });
}

export async function removeModel(options = {}) {
  const dir = getModelDir(options);
  await fsp.rm(dir, { recursive: true, force: true });
  return { ...modelStatus(options), removed: true };
}
