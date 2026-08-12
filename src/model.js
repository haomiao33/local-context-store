import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_MODEL = 'onnx-community/all-MiniLM-L6-v2-ONNX';
export const DEFAULT_DTYPE = 'q8';

const MODEL_FILES = [
  'config.json',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.txt',
  'onnx/model_quantized.onnx',
];

const HF_BASE = 'https://huggingface.co/onnx-community/all-MiniLM-L6-v2-ONNX/resolve/main';

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
  return { model: options.model ?? DEFAULT_MODEL, dir, installed: files.every(file => file.exists), files };
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

export async function installModel({ baseDir = getModelBaseDir(), model = DEFAULT_MODEL, sourceDir, fetchImpl = globalThis.fetch } = {}) {
  if (model !== DEFAULT_MODEL) throw new Error(`unsupported model: ${model}`);
  const destinationDir = getModelDir({ baseDir, model });
  await fsp.mkdir(destinationDir, { recursive: true });
  if (sourceDir) {
    await copyModelDirectory(path.resolve(sourceDir), destinationDir);
  } else {
    for (const file of MODEL_FILES) {
      await downloadFile(`${HF_BASE}/${file}`, path.join(destinationDir, file), fetchImpl);
    }
  }
  return modelStatus({ baseDir, model });
}

export async function removeModel(options = {}) {
  const dir = getModelDir(options);
  await fsp.rm(dir, { recursive: true, force: true });
  return { ...modelStatus(options), removed: true };
}
