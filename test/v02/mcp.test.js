import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const server = path.resolve(process.cwd(), 'src/mcp.js');

function createProject() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-mcp-')); }

// Drives the stdio server the way an MCP client does: newline-delimited
// JSON-RPC, one response object per line.
function callServer(projectDir, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [server], {
      cwd: projectDir,
      env: { ...process.env, LOCAL_CONTEXT_PROJECT: projectDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', () => {
      const responses = out.split('\n').filter(Boolean).map(line => JSON.parse(line));
      resolve({ responses, stderr: err });
    });
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
    child.stdin.end();
    setTimeout(() => child.kill(), 20000).unref();
  });
}

const initialize = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
};

function resultOf(responses, id) {
  const response = responses.find(r => r.id === id);
  assert.ok(response, `no response for id ${id}`);
  assert.ok(!response.error, `unexpected error: ${JSON.stringify(response.error)}`);
  return response.result;
}

function payloadOf(result) {
  return JSON.parse(result.content[0].text);
}

test('mcp server exposes the same capabilities the CLI has', async () => {
  const { responses } = await callServer(createProject(), [
    initialize,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]);
  const names = resultOf(responses, 2).tools.map(tool => tool.name).sort();
  assert.deepEqual(names, ['context_get', 'context_remember', 'context_search', 'context_snapshot', 'context_status']);
});

test('mcp server reports the package version, not a hardcoded one', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  const { responses } = await callServer(createProject(), [initialize]);
  assert.equal(resultOf(responses, 1).serverInfo.version, pkg.version);
});

test('context_search finds an item an agent stored earlier', async () => {
  const projectDir = createProject();
  const { responses } = await callServer(projectDir, [
    initialize,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'context_remember', arguments: { content: 'auth refresh uses Zustand', type: 'decision' } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'context_search', arguments: { query: 'Zustand' } } },
  ]);
  const hits = payloadOf(resultOf(responses, 3));
  assert.equal(hits.length, 1);
  assert.match(hits[0].content, /Zustand/);
});

test('context_status lets an agent check whether retrieval is healthy', async () => {
  const projectDir = createProject();
  const { responses } = await callServer(projectDir, [
    initialize,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'context_remember', arguments: { content: 'payments must stay stable', type: 'constraint', importance: 1 } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'context_status', arguments: {} } },
  ]);
  const status = payloadOf(resultOf(responses, 3));
  assert.equal(status.project.items.total, 1);
  assert.equal(status.project.items.highSignal, 1);
  assert.equal(status.project.fts.drift, false);
  assert.ok(status.version);
});
