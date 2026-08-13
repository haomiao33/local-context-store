function isVector(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

function isWorse(a, b) {
  return a.semanticScore < b.semanticScore
    || (a.semanticScore === b.semanticScore && String(a.id).localeCompare(String(b.id)) > 0);
}

function heapPush(heap, item) {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!isWorse(heap[index], heap[parent])) break;
    [heap[index], heap[parent]] = [heap[parent], heap[index]];
    index = parent;
  }
}

function heapReplaceRoot(heap, item) {
  heap[0] = item;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let worst = index;
    if (left < heap.length && isWorse(heap[left], heap[worst])) worst = left;
    if (right < heap.length && isWorse(heap[right], heap[worst])) worst = right;
    if (worst === index) break;
    [heap[index], heap[worst]] = [heap[worst], heap[index]];
    index = worst;
  }
}

function cosineSimilarityBuffer(query, buffer) {
  if (!isVector(query) || !buffer) throw new Error('dimension mismatch');
  const view = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (view.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('invalid vector buffer');
  }
  const dimensions = view.byteLength / Float32Array.BYTES_PER_ELEMENT;
  if (query.length !== dimensions) throw new Error('dimension mismatch');
  const vector = new Float32Array(view.buffer, view.byteOffset, dimensions);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < dimensions; i++) {
    const x = Number(query[i]);
    const y = vector[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

export function cosineSimilarity(a, b) {
  if (!isVector(a) || !isVector(b) || a.length !== b.length) {
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
  if (!isVector(query) || !Array.isArray(rows) || k <= 0) return [];
  const heap = [];
  for (const row of rows) {
    const vector = row.vector;
    const semanticScore = vector
      ? cosineSimilarity(query, vector)
      : cosineSimilarityBuffer(query, row.vector_blob);

    if (heap.length >= k && !isWorse({ semanticScore, id: row.id }, heap[0])) {
      const candidate = { ...row, semanticScore };
      heapReplaceRoot(heap, candidate);
    } else if (heap.length < k) {
      heapPush(heap, { ...row, semanticScore });
    }
  }
  return heap.sort((a, b) => b.semanticScore - a.semanticScore || String(a.id).localeCompare(String(b.id)));
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
