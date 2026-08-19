import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_MODEL,
  getBundledModelBaseDir,
  isModelAvailable,
  resolveModelBaseDir,
  getModelDir,
  getModelFiles,
  installModel,
  modelStatus,
  ensureModelReady,
} from '../../src/model.js';

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-bundled-')); }

// Writes a model into `baseDir` using the <base>/<org>/<name>/ layout that
// transformers.js resolves.
async function writeModel(baseDir) {
  const dir = getModelDir({ baseDir });
  for (const file of getModelFiles()) {
    const target = path.join(dir, file);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, `fixture:${file}`);
  }
  return dir;
}

function failingFetch() {
  return async url => { throw new Error(`network access is not allowed in this test: ${url}`); };
}

test('the packaged model ships in a directory transformers.js can load directly', () => {
  const baseDir = getBundledModelBaseDir();
  assert.equal(path.basename(baseDir), 'model');
  assert.ok(isModelAvailable({ baseDir }), `expected a complete model under ${getModelDir({ baseDir })}`);
  for (const file of getModelFiles()) {
    assert.ok(fs.existsSync(path.join(baseDir, ...DEFAULT_MODEL.split('/'), file)), `missing ${file}`);
  }
});

test('the packaged model is resolved without copying anything', async () => {
  const baseDir = tempDir();
  const bundledBaseDir = tempDir();
  await writeModel(bundledBaseDir);
  const resolved = resolveModelBaseDir({ baseDir, bundledBaseDir });
  assert.equal(resolved, bundledBaseDir);
  assert.equal(fs.existsSync(getModelDir({ baseDir })), false, 'nothing should be written to the user data directory');
});

test('a model in the user data directory takes precedence over the packaged one', async () => {
  const baseDir = tempDir();
  const bundledBaseDir = tempDir();
  await writeModel(baseDir);
  await writeModel(bundledBaseDir);
  assert.equal(resolveModelBaseDir({ baseDir, bundledBaseDir }), baseDir);
});

test('resolveModelBaseDir returns null when no model is available anywhere', () => {
  assert.equal(resolveModelBaseDir({ baseDir: tempDir(), bundledBaseDir: tempDir() }), null);
});

test('ensureModelReady uses the packaged model in place, offline', async () => {
  const baseDir = tempDir();
  const bundledBaseDir = tempDir();
  await writeModel(bundledBaseDir);
  const ready = await ensureModelReady({ baseDir, bundledBaseDir, fetchImpl: failingFetch() });
  assert.equal(ready.source, 'packaged');
  assert.equal(ready.baseDir, bundledBaseDir);
  assert.equal(fs.existsSync(getModelDir({ baseDir })), false, 'the packaged model must not be copied');
});

test('ensureModelReady downloads only when nothing is available', async () => {
  const baseDir = tempDir();
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(`download:${url}`) };
  };
  const ready = await ensureModelReady({ baseDir, bundledBaseDir: tempDir(), fetchImpl });
  assert.equal(ready.source, 'github');
  assert.equal(ready.baseDir, baseDir);
  assert.equal(requests.length, 7);
});

test('ensureModelReady tells the user how to install when downloads are refused', async () => {
  await assert.rejects(
    () => ensureModelReady({ baseDir: tempDir(), bundledBaseDir: tempDir(), allowDownload: false }),
    /lcs model install/,
  );
});

test('model status reports the packaged model as available without an install step', async () => {
  const baseDir = tempDir();
  const bundledBaseDir = tempDir();
  await writeModel(bundledBaseDir);
  const status = modelStatus({ baseDir, bundledBaseDir });
  assert.equal(status.available, true);
  assert.equal(status.resolvedFrom, 'packaged');
  assert.equal(status.dir, getModelDir({ baseDir: bundledBaseDir }));
  assert.ok(status.files.every(file => file.exists));
});

test('model status reports what is missing when no model is available', () => {
  const status = modelStatus({ baseDir: tempDir(), bundledBaseDir: tempDir() });
  assert.equal(status.available, false);
  assert.equal(status.resolvedFrom, null);
  assert.equal(status.files.length, 7);
  assert.ok(status.files.every(file => !file.exists));
});

test('model install still writes to the user data directory for source checkouts', async () => {
  const baseDir = tempDir();
  const sourceDir = tempDir();
  for (const file of getModelFiles()) {
    const target = path.join(sourceDir, file);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, `fixture:${file}`);
  }
  const status = await installModel({ baseDir, sourceDir, fetchImpl: failingFetch() });
  assert.equal(status.source, 'source');
  assert.equal(isModelAvailable({ baseDir }), true);
});
