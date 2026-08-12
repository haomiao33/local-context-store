import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function openDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT,
      type TEXT NOT NULL CHECK(type IN ('fact','decision','task','constraint','observation','note')),
      content TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_agent TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_items_project ON items(project_id);
    CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      agent TEXT,
      model TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT,
      title TEXT NOT NULL,
      goal TEXT,
      state_json TEXT NOT NULL DEFAULT '{}',
      token_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_project ON snapshots(project_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      id UNINDEXED,
      project_id UNINDEXED,
      content,
      type UNINDEXED,
      tokenize = 'unicode61'
    );
  `);
  return db;
}

export function rebuildFts(db) {
  db.exec("INSERT INTO items_fts(items_fts) VALUES('delete-all');");
  const rows = db.prepare('SELECT id, project_id, content, type FROM items').all();
  const insert = db.prepare('INSERT INTO items_fts(id, project_id, content, type) VALUES (?, ?, ?, ?)');
  const tx = db.transaction(() => rows.forEach(r => insert.run(r.id, r.project_id, r.content, r.type)));
  tx();
}
