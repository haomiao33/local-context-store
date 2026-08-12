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
