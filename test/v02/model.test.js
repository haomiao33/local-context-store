import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_DTYPE, DEFAULT_MODEL, getModelDir, getModelFiles, isModelInstalled, installModel, modelStatus, removeModel } from '../../src/model.js';

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-model-')); }

async function writeFixture(dir) {
  for (const file of getModelFiles()) {
    const target = path.join(dir, file);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, `fixture:${file}`);
  }
}

test('default local model uses the ONNX Community q4 MiniLM manifest', () => {
  assert.equal(DEFAULT_MODEL, 'onnx-community/all-MiniLM-L6-v2-ONNX');
  assert.equal(DEFAULT_DTYPE, 'q4');
  assert.deepEqual(getModelFiles(), [
    'config.json',
    'special_tokens_map.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'vocab.txt',
    'onnx/model_q4.onnx',
    'onnx/model_q4.onnx_data',
  ]);
});

test('model status reports missing local q4 model', () => {
  const baseDir = tempDir();
  const status = modelStatus({ baseDir });
  assert.equal(status.installed, false);
  assert.equal(status.dtype, 'q4');
  assert.equal(isModelInstalled({ baseDir }), false);
  assert.equal(status.files.length, 7);
});

test('model install copies a manually downloaded q4 model without network access', async () => {
  const baseDir = tempDir();
  const sourceDir = tempDir();
  await writeFixture(sourceDir);
  const status = await installModel({ baseDir, sourceDir });
  assert.equal(status.installed, true);
  assert.ok(fs.existsSync(path.join(getModelDir({ baseDir }), 'onnx', 'model_q4.onnx')));
  assert.ok(fs.existsSync(path.join(getModelDir({ baseDir }), 'onnx', 'model_q4.onnx_data')));
});

// bundledDir: null forces the remote path; the packaged model would otherwise
// win. Remote source order itself is covered in bundled-model.test.js.
test('model install downloads the exact q4 runtime manifest', async () => {
  const baseDir = tempDir();
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(`download:${url}`) };
  };
  const status = await installModel({ baseDir, bundledDir: null, fetchImpl });
  assert.equal(status.installed, true);
  assert.equal(requests.length, 7);
  for (const file of getModelFiles()) assert.ok(requests.some(url => url.endsWith(`/${file}`)), `no request for ${file}`);
  assert.ok(requests.some(url => url.endsWith('/onnx/model_q4.onnx_data')));
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
