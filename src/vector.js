export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    throw new Error('dimension mismatch');
  }
  if (a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

export function topKSimilar(query, rows, k = 20) {
  if (!Array.isArray(rows) || k <= 0) return [];
  return rows
    .map(row => ({ ...row, semanticScore: cosineSimilarity(query, row.vector) }))
    .sort((a, b) => b.semanticScore - a.semanticScore || String(a.id).localeCompare(String(b.id)))
    .slice(0, k);
}

export function encodeVector(vector) {
  if (!Array.isArray(vector)) throw new Error('vector must be an array');
  const floats = new Float32Array(vector);
  return Buffer.from(floats.buffer);
}

export function decodeVector(buffer) {
  if (!buffer) return null;
  const view = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (view.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('invalid vector buffer');
  }
  return Array.from(new Float32Array(view.buffer, view.byteOffset, view.byteLength / Float32Array.BYTES_PER_ELEMENT));
}
