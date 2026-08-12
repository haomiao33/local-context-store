import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';
import { getEmbeddingProvider } from '../src/embedding.js';
import { topKSimilar } from '../src/vector.js';
import { hybridRank } from '../src/hybrid.js';

const sizes = (process.env.LCS_BENCH_SIZES ?? '1000,10000,100000')
  .split(',').map(Number).filter(Number.isInteger).filter(n => n > 0);
const queries = Number(process.env.LCS_BENCH_QUERIES ?? 30);
const semanticMax = Number(process.env.LCS_BENCH_SEMANTIC_MAX ?? 10000);
const vectorDimensions = Number(process.env.LCS_BENCH_VECTOR_DIMS ?? 32);

const templates = [
  ['decision', 'Auth state uses Zustand and refresh state stays in the auth store.'],
  ['constraint', 'Public authentication API must not change.'],
  ['observation', 'Refresh requests can race when multiple API calls expire together.'],
  ['task', 'Fix token refresh concurrency without changing the public auth API.'],
  ['fact', 'The API client retries failed requests after a refresh token update.'],
  ['note', 'The mutex implementation previously caused a deadlock during refresh.'],
  ['decision', 'Use a single refresh promise so overlapping requests share one refresh operation.'],
  ['constraint', 'Do not introduce a cloud dependency for local context retrieval.'],
  ['observation', 'CSS grid layout is independent from authentication refresh behavior.'],
  ['fact', 'The project uses SQLite WAL mode for concurrent local readers and writers.'],
];

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function formatMs(value) {
  return `${value.toFixed(2)}ms`;
}

function randomVector(seed, dimensions) {
  let x = (seed + 1) * 2654435761;
  const vector = new Array(dimensions);
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    const value = ((x >>> 0) / 4294967296) * 2 - 1;
    vector[i] = value;
    norm += value * value;
  }
  norm = Math.sqrt(norm) || 1;
  return vector.map(v => v / norm);
}

function corpusItem(i) {
  const [type, text] = templates[i % templates.length];
  return {
    id: `bench-${i}`,
    type,
    content: `${text} Context record ${i} includes project-local engineering details for benchmark retrieval.`,
  };
}

function createBenchDir(size) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `lcs-bench-${size}-`));
}

function seedDatabase(dir, size) {
  const db = openDatabase(path.join(dir, '.context', 'context.db'));
  const insert = db.prepare(`
    INSERT INTO items(id, project_id, type, content, importance, created_at, updated_at, metadata_json)
    VALUES (?, 'bench', ?, ?, ?, ?, ?, '{}')
  `);
  const insertFts = db.prepare('INSERT INTO items_fts(id, project_id, content, type) VALUES (?, ?, ?, ?)');
  const timestamp = new Date().toISOString();
  const tx = db.transaction(() => {
    for (let i = 0; i < size; i++) {
      const item = corpusItem(i);
      const importance = ((i % 100) + 1) / 100;
      insert.run(item.id, item.type, item.content, importance, timestamp, timestamp);
      insertFts.run(item.id, 'bench', item.content, item.type);
    }
  });
  const start = performance.now();
  tx();
  const elapsed = performance.now() - start;
  return { db, elapsed };
}

function benchmarkFts(db, size) {
  const querySet = [
    'authentication refresh',
    'public API constraint',
    'SQLite concurrency',
    'CSS grid',
    'refresh promise',
  ];
  const samples = [];
  for (let i = 0; i < queries; i++) {
    const query = querySet[i % querySet.length];
    const start = performance.now();
    db.prepare(`
      SELECT i.id, i.content, bm25(items_fts) AS fts_rank
      FROM items_fts
      JOIN items i ON i.id = items_fts.id
      WHERE items_fts.project_id = 'bench' AND items_fts MATCH ?
      ORDER BY bm25(items_fts) ASC, i.importance DESC, i.updated_at DESC
      LIMIT 20
    `).all(query.split(' ').map(token => `"${token}"*`).join(' OR '));
    samples.push(performance.now() - start);
  }
  return { size, p50: percentile(samples, 50), p95: percentile(samples, 95) };
}

function benchmarkContextPack(dir) {
  const store = createStore(dir);
  const samples = [];
  for (let i = 0; i < Math.min(queries, 20); i++) {
    const start = performance.now();
    store.context({ projectId: 'bench', task: i % 2 ? 'authentication refresh race' : 'SQLite concurrent API', budget: 2000, limit: 20 });
    samples.push(performance.now() - start);
  }
  store.close();
  return { p50: percentile(samples, 50), p95: percentile(samples, 95) };
}

function benchmarkVector(size) {
  const candidates = new Array(size);
  for (let i = 0; i < size; i++) {
    candidates[i] = { id: `v-${i}`, vector: randomVector(i, vectorDimensions) };
  }
  const queryVector = candidates[Math.floor(size / 3)].vector;
  const count = size >= 100000 ? 5 : 10;
  const samples = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    topKSimilar(queryVector, candidates, 20);
    samples.push(performance.now() - start);
  }
  return { p50: percentile(samples, 50), p95: percentile(samples, 95) };
}

async function benchmarkLocalEmbedding() {
  const provider = getEmbeddingProvider({ backend: 'local' });
  const text = 'Fix authentication refresh concurrency without changing the public auth API.';
  const rssBefore = process.memoryUsage().rss;
  const coldStart = performance.now();
  await provider.embed(text);
  const coldMs = performance.now() - coldStart;
  const warmSamples = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await provider.embed(`${text} query ${i}`);
    warmSamples.push(performance.now() - start);
  }
  const rssAfter = process.memoryUsage().rss;
  return {
    model: provider.model,
    dimensions: provider.dimensions,
    coldMs,
    warmP50: percentile(warmSamples, 50),
    warmP95: percentile(warmSamples, 95),
    rssDeltaMB: (rssAfter - rssBefore) / 1024 / 1024,
  };
}

async function main() {
  console.log('Local Context Store v0.2 benchmark');
  console.log(`sizes=${sizes.join(',')} queries=${queries} vectorDims=${vectorDimensions}`);
  console.log('Synthetic corpus is deterministic. Benchmark DBs are temporary and deleted after each run.');
  console.log('');

  console.log('FTS5 + lexical Context Pack');
  console.log('size\tseed\tFTS p50\tFTS p95\tContext p50\tContext p95');
  for (const size of sizes) {
    const dir = createBenchDir(size);
    try {
      const { db, elapsed } = seedDatabase(dir, size);
      const fts = benchmarkFts(db, size);
      const context = benchmarkContextPack(dir);
      console.log(`${size}\t${formatMs(elapsed)}\t${formatMs(fts.p50)}\t${formatMs(fts.p95)}\t${formatMs(context.p50)}\t${formatMs(context.p95)}`);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('');
  console.log('In-memory vector search (synthetic normalized vectors)');
  console.log('size\tvector p50\tvector p95');
  for (const size of sizes) {
    const result = benchmarkVector(size);
    console.log(`${size}\t${formatMs(result.p50)}\t${formatMs(result.p95)}`);
  }

  console.log('');
  console.log(`Hybrid/semantic full indexing is capped at ${semanticMax} items in this benchmark to avoid silently creating a huge local embedding workload.`);
  console.log('Use LCS_BENCH_LOCAL_EMBED=1 for the real local model measurement.');
  if (process.env.LCS_BENCH_LOCAL_EMBED === '1') {
    const result = await benchmarkLocalEmbedding();
    console.log(`local model: ${result.model}`);
    console.log(`dimensions: ${result.dimensions}`);
    console.log(`cold embedding: ${formatMs(result.coldMs)}`);
    console.log(`warm embedding p50: ${formatMs(result.warmP50)}`);
    console.log(`warm embedding p95: ${formatMs(result.warmP95)}`);
    console.log(`RSS delta: ${result.rssDeltaMB.toFixed(1)}MB`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
