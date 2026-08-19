import crypto from 'node:crypto';
import path from 'node:path';
import { openDatabase } from './db.js';
import { decodeVector, encodeVector } from './vector.js';
import { getEmbeddingProvider, hashText, DEFAULT_EMBEDDING_MODEL } from './embedding.js';
import { hybridRank } from './hybrid.js';
import { withSqliteRetry } from './sqlite-retry.js';

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

export const ITEM_TYPES = ['fact','decision','task','constraint','observation','note'];

function queryTokens(query) {
  return query.trim().split(/\s+/)
    .map(x => x.replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter(Boolean);
}

function ftsQuery(query) {
  return queryTokens(query)
    .map(t => `"${t.replaceAll('"', '""')}"*`)
    .join(' OR ');
}

function lexicalScore(item) {
  const bm25 = Number(item.fts_rank);
  return Number.isFinite(bm25) ? 1 / (1 + Math.max(0, bm25)) : 0;
}

function recencyScore(updatedAt) {
  const ageDays = Math.max(0, (Date.now() - Date.parse(updatedAt)) / 86400000);
  return 1 / (1 + ageDays / 30);
}

function selectBudget(items, budget) {
  const selected = [];
  let tokens = 0;
  for (const item of items) {
    const itemTokens = Math.ceil(item.content.length / 4) + 12;
    if (selected.length && tokens + itemTokens > budget) continue;
    selected.push(item);
    tokens += itemTokens;
    if (tokens >= budget) break;
  }
  return { items: selected, tokenCount: tokens };
}

export class ContextStore {
  constructor(db) { this.db = db; }

  startSession({ projectId, agent = null, model = null } = {}) {
    const sessionId = id();
    withSqliteRetry(() => this.db.prepare(`INSERT INTO sessions(id, project_id, agent, model, started_at) VALUES (?, ?, ?, ?, ?)`).run(sessionId, projectId, agent, model, now()));
    return sessionId;
  }

  remember({ projectId, sessionId = null, type = 'note', content, importance = 0.5, agent = null, metadata = {} }) {
    if (!projectId) throw new Error('projectId is required');
    if (!content?.trim()) throw new Error('content is required');
    if (!ITEM_TYPES.includes(type)) throw new Error(`invalid type: ${type}`);
    const itemId = id();
    const timestamp = now();
    const score = Number(importance);
    if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error('importance must be a number between 0 and 1');
    const insert = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO items(id, project_id, session_id, type, content, importance, created_at, updated_at, source_agent, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(itemId, projectId, sessionId, type, content.trim(), score, timestamp, timestamp, agent, JSON.stringify(metadata));
      this.db.prepare(`INSERT INTO items_fts(id, project_id, content, type) VALUES (?, ?, ?, ?)`).run(itemId, projectId, content.trim(), type);
    });
    withSqliteRetry(insert);
    return this.get(itemId);
  }

  get(itemId) {
    return this.db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) ?? null;
  }

  saveEmbedding({ itemId, model, vector, contentHash }) {
    if (!itemId || !model || !Array.isArray(vector) || !contentHash) throw new Error('itemId, model, vector and contentHash are required');
    withSqliteRetry(() => this.db.prepare(`
      INSERT INTO item_embeddings(item_id, model, dimensions, vector, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        model = excluded.model,
        dimensions = excluded.dimensions,
        vector = excluded.vector,
        content_hash = excluded.content_hash,
        created_at = excluded.created_at
    `).run(itemId, model, vector.length, encodeVector(vector), contentHash, now()));
  }

  getEmbedding(itemId, contentHash = null, model = null) {
    const row = this.db.prepare('SELECT * FROM item_embeddings WHERE item_id = ?').get(itemId);
    if (!row || (contentHash && row.content_hash !== contentHash) || (model && row.model !== model)) return null;
    return {
      ...row,
      contentHash: row.content_hash,
      vector: decodeVector(row.vector),
    };
  }

  async indexEmbeddings({ projectId, embeddingProvider = getEmbeddingProvider() } = {}) {
    const items = this.db.prepare('SELECT id, content FROM items WHERE project_id = ? ORDER BY created_at ASC').all(projectId);
    const existing = new Map(this.db.prepare(`
      SELECT item_id, content_hash
      FROM item_embeddings
      WHERE model = ?
    `).all(embeddingProvider.model).map(row => [row.item_id, row.content_hash]));

    let indexed = 0;
    for (const item of items) {
      const contentHash = hashText(item.content);
      if (existing.get(item.id) === contentHash) continue;
      const vector = await embeddingProvider.embed(item.content);
      this.saveEmbedding({ itemId: item.id, model: embeddingProvider.model, vector, contentHash });
      existing.set(item.id, contentHash);
      indexed++;
    }
    return { indexed, total: items.length };
  }

  async contextAsync({ projectId, task, budget = 8000, limit = 50, semanticThreshold = 0.2, embeddingProvider = getEmbeddingProvider(), weights } = {}) {
    if (!task?.trim()) return { projectId, task, tokenCount: 0, items: [] };
    await this.indexEmbeddings({ projectId, embeddingProvider });

    const lexicalById = new Map();
    for (const item of this.search({ projectId, query: task, limit })) lexicalById.set(item.id, item);
    for (const token of queryTokens(task)) {
      for (const item of this.search({ projectId, query: token, limit })) {
        if (!lexicalById.has(item.id)) lexicalById.set(item.id, item);
      }
    }

    const queryVector = await embeddingProvider.embed(task);
    const rows = this.db.prepare(`
      SELECT i.id, i.importance, i.updated_at, e.vector AS embedding_vector
      FROM item_embeddings e
      JOIN items i ON i.id = e.item_id
      WHERE i.project_id = ? AND e.model = ?
    `).all(projectId, embeddingProvider.model);
    const semantic = rows.map(row => ({
      id: row.id,
      importance: row.importance,
      recency: recencyScore(row.updated_at),
      semanticScore: embeddingProvider.similarity(queryVector, decodeVector(row.embedding_vector)),
    })).filter(item => item.semanticScore >= semanticThreshold);

    const lexical = [...lexicalById.values()].map(item => ({
      ...item,
      ftsScore: lexicalScore(item),
      importance: item.importance,
      recency: recencyScore(item.updated_at),
    }));

    const ranked = hybridRank({ lexical, semantic, weights });
    const missingContentIds = ranked.filter(item => !item.content).map(item => item.id);
    if (missingContentIds.length) {
      const placeholders = missingContentIds.map(() => '?').join(',');
      const hydrated = this.db.prepare(`SELECT * FROM items WHERE project_id = ? AND id IN (${placeholders})`).all(projectId, ...missingContentIds);
      const byId = new Map(hydrated.map(item => [item.id, item]));
      for (const item of ranked) {
        const full = byId.get(item.id);
        if (full) Object.assign(item, full);
      }
    }
    const selected = selectBudget(ranked, budget);
    return { projectId, task, tokenCount: selected.tokenCount, items: selected.items };
  }

  search({ projectId, query, limit = 20 }) {
    if (!query?.trim()) return this.db.prepare('SELECT * FROM items WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?').all(projectId, limit);
    const match = ftsQuery(query);
    if (!match) return [];
    return this.db.prepare(`
      SELECT i.*, bm25(items_fts) AS fts_rank
      FROM items_fts
      JOIN items i ON i.id = items_fts.id
      WHERE items_fts.project_id = ? AND items_fts MATCH ?
      ORDER BY bm25(items_fts) ASC, i.importance DESC, i.updated_at DESC
      LIMIT ?
    `).all(projectId, match, limit);
  }

  context({ projectId, task, budget = 8000, limit = 50 }) {
    const byId = new Map();
    for (const item of this.search({ projectId, query: task, limit })) byId.set(item.id, item);
    for (const token of queryTokens(task)) {
      for (const item of this.search({ projectId, query: token, limit })) {
        if (!byId.has(item.id)) byId.set(item.id, item);
      }
    }
    const ranked = [...byId.values()].slice(0, limit).map(item => ({
      ...item,
      score: lexicalScore(item) * 0.55 + item.importance * 0.30 + recencyScore(item.updated_at) * 0.15,
    })).sort((a,b) => b.score - a.score);
    const selected = selectBudget(ranked, budget);
    return { projectId, task, tokenCount: selected.tokenCount, items: selected.items };
  }

  snapshot({ projectId, sessionId = null, title, goal = null, state = {}, tokenCount = 0 }) {
    const snapshotId = id();
    withSqliteRetry(() => this.db.prepare(`INSERT INTO snapshots(id, project_id, session_id, title, goal, state_json, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(snapshotId, projectId, sessionId, title, goal, JSON.stringify(state), tokenCount, now()));
    return this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(snapshotId);
  }

  // Read-only summary of what an agent can actually retrieve from this project.
  // The two retrieval numbers are the point: a drifted FTS index makes search
  // silently miss items, and a stale embedding makes `--semantic` recompute.
  stats({ projectId, model = DEFAULT_EMBEDDING_MODEL } = {}) {
    if (!projectId) throw new Error('projectId is required');

    const totals = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(importance >= 0.8), 0) AS high_signal,
        MAX(updated_at) AS newest,
        MIN(updated_at) AS oldest
      FROM items WHERE project_id = ?
    `).get(projectId);

    const byType = {};
    for (const row of this.db.prepare('SELECT type, COUNT(*) AS count FROM items WHERE project_id = ? GROUP BY type ORDER BY count DESC, type ASC').all(projectId)) {
      byType[row.type] = row.count;
    }

    const indexed = this.db.prepare('SELECT COUNT(*) AS count FROM items_fts WHERE project_id = ?').get(projectId).count;

    // content_hash is compared in JS because the hash is not stored on items.
    const embeddable = this.db.prepare(`
      SELECT i.content AS content, e.content_hash AS content_hash
      FROM items i
      LEFT JOIN item_embeddings e ON e.item_id = i.id AND e.model = ?
      WHERE i.project_id = ?
    `).all(model, projectId);
    const current = embeddable.filter(row => row.content_hash && row.content_hash === hashText(row.content)).length;

    const latest = this.db.prepare('SELECT title, goal, created_at FROM snapshots WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(projectId);

    return {
      projectId,
      items: {
        total: totals.total,
        byType,
        highSignal: totals.high_signal,
        newestUpdatedAt: totals.newest ?? null,
        oldestUpdatedAt: totals.oldest ?? null,
      },
      sessions: {
        total: this.db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE project_id = ?').get(projectId).count,
      },
      snapshots: {
        total: this.db.prepare('SELECT COUNT(*) AS count FROM snapshots WHERE project_id = ?').get(projectId).count,
        latest: latest ? { title: latest.title, goal: latest.goal ?? null, createdAt: latest.created_at } : null,
      },
      fts: { total: totals.total, indexed, drift: indexed !== totals.total },
      embeddings: { total: totals.total, current, model },
    };
  }

  latestSnapshot(projectId) {
    // created_at is millisecond-resolution, so rowid breaks ties by insertion
    // order; without it two snapshots taken in the same millisecond can resolve
    // to the older one.
    const row = this.db.prepare('SELECT * FROM snapshots WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(projectId);
    if (!row) return null;
    return { ...row, state: JSON.parse(row.state_json) };
  }

  close() { this.db.close(); }
}

export function projectDatabase(projectDir) {
  return path.join(projectDir, '.context', 'context.db');
}

export function createStore(projectDir) {
  return new ContextStore(openDatabase(projectDatabase(projectDir)));
}
