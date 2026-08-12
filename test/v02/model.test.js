import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_MODEL, getModelDir, getModelFiles, isModelInstalled, installModel, modelStatus, removeModel } from '../../src/model.js';

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-model-')); }

async function writeFixture(dir) {
  for (const file of getModelFiles()) {
    const target = path.join(dir, file);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, `fixture:${file}`);
  }
}

test('default local model uses Xenova all-MiniLM-L6-v2', () => {
  assert.equal(DEFAULT_MODEL, 'Xenova/all-MiniLM-L6-v2');
});

test('model status reports missing local model', () => {
  const baseDir = tempDir();
  const status = modelStatus({ baseDir });
  assert.equal(status.installed, false);
  assert.equal(isModelInstalled({ baseDir }), false);
  assert.equal(status.files.length, 6);
});

test('model install copies a local model fixture without network access', async () => {
  const baseDir = tempDir();
  const sourceDir = tempDir();
  await writeFixture(sourceDir);
  const status = await installModel({ baseDir, sourceDir });
  assert.equal(status.installed, true);
  assert.ok(fs.existsSync(path.join(getModelDir({ baseDir }), 'onnx', 'model_quantized.onnx')));
  assert.equal(fs.readFileSync(path.join(getModelDir({ baseDir }), 'config.json'), 'utf8'), 'fixture:config.json');
});

test('model install downloads the exact runtime manifest', async () => {
  const baseDir = tempDir();
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(`download:${url}`) };
  };
  const status = await installModel({ baseDir, fetchImpl });
  assert.equal(status.installed, true);
  assert.equal(requests.length, 6);
  assert.ok(requests.every(url => url.includes('/Xenova/all-MiniLM-L6-v2/resolve/main/')));
  assert.ok(requests.some(url => url.endsWith('/onnx/model_quantized.onnx')));
});

test('model remove deletes only the local model directory', async () => {
  const baseDir = tempDir();
  const sourceDir = tempDir();
  await writeFixture(sourceDir);
  await installModel({ baseDir, sourceDir });
  await removeModel({ baseDir });
  assert.equal(isModelInstalled({ baseDir }), false);
  assert.equal(fs.existsSync(getModelDir({ baseDir })), false);
});
