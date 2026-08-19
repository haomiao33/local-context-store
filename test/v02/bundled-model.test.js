import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getBundledModelDir,
  isBundledModelAvailable,
  getModelDir,
  getModelFiles,
  installModel,
  modelStatus,
  ensureModelReady,
  isModelInstalled,
} from '../../src/model.js';

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-bundled-')); }

async function writeFixture(dir) {
  for (const file of getModelFiles()) {
    const target = path.join(dir, file);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, `fixture:${file}`);
  }
}

function failingFetch() {
  return async url => { throw new Error(`network access is not allowed in this test: ${url}`); };
}

test('bundled model directory ships inside the package', () => {
  const dir = getBundledModelDir();
  assert.equal(path.basename(dir), 'model');
  assert.ok(fs.existsSync(dir), `expected the packaged model directory at ${dir}`);
  assert.equal(isBundledModelAvailable(), true);
});

test('isBundledModelAvailable is false when the packaged model is incomplete', async () => {
  const bundledDir = tempDir();
  await writeFixture(bundledDir);
  await fsp.rm(path.join(bundledDir, 'onnx', 'model_q4.onnx_data'));
  assert.equal(isBundledModelAvailable(bundledDir), false);
});

test('model install prefers the packaged model over the network', async () => {
  const baseDir = tempDir();
  const bundledDir = tempDir();
  await writeFixture(bundledDir);
  const status = await installModel({ baseDir, bundledDir, fetchImpl: failingFetch() });
  assert.equal(status.installed, true);
  assert.equal(status.source, 'bundled');
  assert.equal(fs.readFileSync(path.join(getModelDir({ baseDir }), 'config.json'), 'utf8'), 'fixture:config.json');
});

test('model install falls back to the GitHub repository when nothing is packaged', async () => {
  const baseDir = tempDir();
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(`download:${url}`) };
  };
  const status = await installModel({ baseDir, bundledDir: null, fetchImpl });
  assert.equal(status.installed, true);
  assert.equal(status.source, 'github');
  assert.equal(requests.length, 7);
  assert.ok(requests.every(url => url.startsWith('https://raw.githubusercontent.com/haomiao33/local-context-store/')));
  assert.ok(requests.some(url => url.endsWith('/onnx/model_q4.onnx_data')));
});

test('model install falls back to HuggingFace when the repository is unreachable', async () => {
  const baseDir = tempDir();
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    if (url.includes('raw.githubusercontent.com')) return { ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) };
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(`download:${url}`) };
  };
  const status = await installModel({ baseDir, bundledDir: null, fetchImpl });
  assert.equal(status.installed, true);
  assert.equal(status.source, 'huggingface');
  assert.ok(requests.some(url => url.includes('huggingface.co')));
});

test('model status reports whether the packaged model is available', async () => {
  const baseDir = tempDir();
  const bundledDir = tempDir();
  await writeFixture(bundledDir);
  const status = modelStatus({ baseDir, bundledDir });
  assert.equal(status.installed, false);
  assert.equal(status.bundled.available, true);
  assert.equal(status.bundled.dir, bundledDir);
});

test('ensureModelReady installs from the packaged model without network access', async () => {
  const baseDir = tempDir();
  const bundledDir = tempDir();
  await writeFixture(bundledDir);
  assert.equal(isModelInstalled({ baseDir }), false);
  const status = await ensureModelReady({ baseDir, bundledDir, fetchImpl: failingFetch() });
  assert.equal(status.installed, true);
  assert.equal(status.source, 'bundled');
  assert.equal(isModelInstalled({ baseDir }), true);
});

test('ensureModelReady is a no-op when the model is already installed', async () => {
  const baseDir = tempDir();
  const sourceDir = tempDir();
  await writeFixture(sourceDir);
  await installModel({ baseDir, sourceDir });
  const status = await ensureModelReady({ baseDir, bundledDir: null, fetchImpl: failingFetch() });
  assert.equal(status.installed, true);
  assert.equal(status.source, 'installed');
});

test('ensureModelReady tells the user how to install when nothing is available offline', async () => {
  const baseDir = tempDir();
  await assert.rejects(
    () => ensureModelReady({ baseDir, bundledDir: null, allowDownload: false }),
    /lcs model install/,
  );
});
