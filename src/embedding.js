import crypto from 'node:crypto';
import { cosineSimilarity } from './vector.js';
import { DEFAULT_MODEL, DEFAULT_DTYPE, getModelBaseDir, resolveModelBaseDir } from './model.js';

const DEFAULT_DIMENSIONS = 384;
const providers = new Map();

export function hashText(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function normalize(vector) {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (!norm) return vector;
  return vector.map(value => value / norm);
}

function hashEmbedding(text, dimensions) {
  const vector = new Float32Array(dimensions);
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, ' ').trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const features = [token];
    for (let i = 0; i < token.length - 2; i++) features.push(token.slice(i, i + 3));
    for (const feature of features) {
      const digest = crypto.createHash('sha256').update(feature).digest();
      const index = digest.readUInt32LE(0) % dimensions;
      const sign = digest[4] & 1 ? -1 : 1;
      vector[index] += sign;
    }
  }
  return Array.from(normalize(Array.from(vector)));
}

async function createLocalPipeline({ model, dtype = DEFAULT_DTYPE }) {
  const { env, pipeline } = await import('@huggingface/transformers');
  // Points at the packaged model when nothing is installed locally, so the
  // model is read straight out of the package instead of being copied first.
  env.localModelPath = resolveModelBaseDir({ model }) ?? getModelBaseDir();
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  return pipeline('feature-extraction', model, { dtype });
}

export function createEmbeddingProvider({
  model = DEFAULT_MODEL,
  dimensions = DEFAULT_DIMENSIONS,
  backend = 'local',
  dtype = DEFAULT_DTYPE,
  pipelineFactory = createLocalPipeline,
} = {}) {
  let pipelinePromise = null;

  async function embed(text) {
    if (!text?.trim()) throw new Error('text is required');
    if (backend === 'hash') return hashEmbedding(text, dimensions);

    if (!pipelinePromise) pipelinePromise = Promise.resolve(pipelineFactory({ model, dtype }));
    const extractor = await pipelinePromise;
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  return { model, dimensions, backend, dtype, embed, similarity: cosineSimilarity };
}

export function getEmbeddingProvider(options = {}) {
  const key = JSON.stringify({
    model: options.model ?? DEFAULT_MODEL,
    dimensions: options.dimensions ?? DEFAULT_DIMENSIONS,
    backend: options.backend ?? 'local',
    dtype: options.dtype ?? DEFAULT_DTYPE,
  });
  if (!providers.has(key)) providers.set(key, createEmbeddingProvider(options));
  return providers.get(key);
}

export const DEFAULT_EMBEDDING_MODEL = DEFAULT_MODEL;
export const DEFAULT_EMBEDDING_DIMENSIONS = DEFAULT_DIMENSIONS;
export const DEFAULT_EMBEDDING_DTYPE = DEFAULT_DTYPE;
