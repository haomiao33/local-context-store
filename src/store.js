import crypto from 'node:crypto';
import path from 'node:path';
import { openDatabase } from './db.js';

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

export class ContextStore {
  constructor(db) { this.db = db; }

  startSession({ projectId, agent = null, model = null } = {}) {
    const sessionId = id();
    this.db.prepare(`INSERT INTO sessions(id, project_id, agent, model, started_at) VALUES (?, ?, ?, ?, ?)`)
      .run(sessionId, projectId, agent, model, now());
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
    this.db.prepare(`INSERT INTO items(id, project_id, session_id, type, content, importance, created_at, updated_at, source_agent, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(itemId, projectId, sessionId, type, content.trim(), score, timestamp, timestamp, agent, JSON.stringify(metadata));
    this.db.prepare(`INSERT INTO items_fts(id, project_id, content, type) VALUES (?, ?, ?, ?)`)
      .run(itemId, projectId, content.trim(), type);
    return this.get(itemId);
  }

  get(itemId) {
    return this.db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) ?? null;
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
    const primary = this.search({ projectId, query: task, limit });
    const byId = new Map(primary.map(item => [item.id, item]));

    // Fallback to per-term retrieval so a task still produces useful context
    // when a multi-term FTS query returns no rows.
    if (!primary.length) {
      for (const token of queryTokens(task)) {
        for (const item of this.search({ projectId, query: token, limit })) {
          byId.set(item.id, item);
        }
      }
    }

    const candidates = [...byId.values()].slice(0, limit);
    const nowMs = Date.now();
    const ranked = candidates.map(item => {
      const ageDays = Math.max(0, (nowMs - Date.parse(item.updated_at)) / 86400000);
      const recency = 1 / (1 + ageDays / 30);
      const bm25 = Number(item.fts_rank);
      const lexical = Number.isFinite(bm25) ? 1 / (1 + Math.max(0, bm25)) : 0;
      return { ...item, score: lexical * 0.55 + item.importance * 0.30 + recency * 0.15 };
    }).sort((a,b) => b.score - a.score);

    const selected = [];
    let tokens = 0;
    for (const item of ranked) {
      const itemTokens = Math.ceil(item.content.length / 4) + 12;
      if (selected.length && tokens + itemTokens > budget) continue;
      selected.push(item);
      tokens += itemTokens;
      if (tokens >= budget) break;
    }
    return { projectId, task, tokenCount: tokens, items: selected };
  }

  snapshot({ projectId, sessionId = null, title, goal = null, state = {}, tokenCount = 0 }) {
    const snapshotId = id();
    this.db.prepare(`INSERT INTO snapshots(id, project_id, session_id, title, goal, state_json, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(snapshotId, projectId, sessionId, title, goal, JSON.stringify(state), tokenCount, now());
    return this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(snapshotId);
  }

  latestSnapshot(projectId) {
    const row = this.db.prepare('SELECT * FROM snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(projectId);
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
