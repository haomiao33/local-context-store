const DEFAULT_WEIGHTS = {
  lexical: 0.35,
  semantic: 0.45,
  importance: 0.15,
  recency: 0.05,
};

function normalizeScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

export function hybridRank({ lexical = [], semantic = [], weights = DEFAULT_WEIGHTS } = {}) {
  const byId = new Map();
  const add = (row, source) => {
    if (!row?.id) return;
    const current = byId.get(row.id) ?? { ...row };
    if (source === 'lexical') current.ftsScore = Math.max(normalizeScore(current.ftsScore), normalizeScore(row.ftsScore));
    if (source === 'semantic') current.semanticScore = Math.max(normalizeScore(current.semanticScore), normalizeScore(row.semanticScore));
    if (row.importance != null) current.importance = normalizeScore(row.importance);
    if (row.recency != null) current.recency = normalizeScore(row.recency);
    byId.set(row.id, current);
  };

  lexical.forEach(row => add(row, 'lexical'));
  semantic.forEach(row => add(row, 'semantic'));

  return [...byId.values()]
    .map(row => ({
      ...row,
      score:
        normalizeScore(row.ftsScore) * (weights.lexical ?? DEFAULT_WEIGHTS.lexical) +
        normalizeScore(row.semanticScore) * (weights.semantic ?? DEFAULT_WEIGHTS.semantic) +
        normalizeScore(row.importance ?? 0) * (weights.importance ?? DEFAULT_WEIGHTS.importance) +
        normalizeScore(row.recency ?? 0) * (weights.recency ?? DEFAULT_WEIGHTS.recency),
    }))
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
}

export { DEFAULT_WEIGHTS };
