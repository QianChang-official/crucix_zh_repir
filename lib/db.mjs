// lib/db.mjs — SQLite persistence layer for Crucix sweep data
// Uses better-sqlite3 for synchronous, fast, local storage.

import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_PATH = join(DATA_DIR, 'crucix.db');

let db = null;

async function getDb() {
  if (db) return db;
  try {
    // Dynamic import to keep better-sqlite3 optional
    const mod = await import('better-sqlite3');
    const Database = mod.default || mod;
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    return db;
  } catch (e) {
    console.error('[DB] better-sqlite3 not available, persistence disabled:', e.message);
    return null;
  }
}

// Lazy async init wrapper
let initPromise = null;
export async function initDb() {
  if (!initPromise) initPromise = getDb();
  return initPromise;
}

function initSchema() {
  if (!db) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS sweep_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      sources_queried INTEGER,
      sources_ok INTEGER,
      sources_failed INTEGER,
      duration_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS source_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sweep_id INTEGER NOT NULL REFERENCES sweep_runs(id),
      source_name TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER,
      data_json TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS news_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sweep_id INTEGER,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      url TEXT,
      series TEXT,
      region TEXT,
      published_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS flight_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_date TEXT NOT NULL,
      source TEXT,
      data_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS section_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sweep_id INTEGER NOT NULL REFERENCES sweep_runs(id),
      section TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sweep_ts ON sweep_runs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_source_data_sweep ON source_data(sweep_id);
    CREATE INDEX IF NOT EXISTS idx_news_published ON news_items(published_at);
    CREATE INDEX IF NOT EXISTS idx_news_source ON news_items(source);
    CREATE INDEX IF NOT EXISTS idx_flight_date ON flight_cache(cache_date);
    CREATE INDEX IF NOT EXISTS idx_section_sweep ON section_snapshots(sweep_id, section);
  `);
}

// === Sweep persistence ===

export async function saveSweepRun(meta, errors = []) {
  const d = await initDb();
  if (!d) return null;
  try {
    const stmt = d.prepare(`
      INSERT INTO sweep_runs (timestamp, sources_queried, sources_ok, sources_failed, duration_ms)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      meta.timestamp || new Date().toISOString(),
      meta.sourcesQueried || 0,
      meta.sourcesOk || 0,
      meta.sourcesFailed || 0,
      meta.totalDurationMs || 0,
    );
    return result.lastInsertRowid;
  } catch (e) {
    console.error('[DB] saveSweepRun error:', e.message);
    return null;
  }
}

export async function saveSectionSnapshot(sweepId, section, data) {
  const d = await initDb();
  if (!d || !sweepId) return;
  try {
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    d.prepare('INSERT INTO section_snapshots (sweep_id, section, data_json) VALUES (?, ?, ?)').run(sweepId, section, json);
  } catch (e) {
    console.error('[DB] saveSectionSnapshot error:', e.message);
  }
}

export async function saveSourceErrors(sweepId, errors) {
  const d = await initDb();
  if (!d || !sweepId || !errors?.length) return;
  try {
    const stmt = d.prepare('INSERT INTO source_data (sweep_id, source_name, status, duration_ms, error) VALUES (?, ?, ?, ?, ?)');
    const tx = d.transaction((rows) => {
      for (const row of rows) stmt.run(row.sweepId, row.name, 'error', 0, row.error);
    });
    tx(errors.map(e => ({ sweepId, name: e.name || 'Unknown', error: String(e.error || '') })));
  } catch (e) {
    console.error('[DB] saveSourceErrors error:', e.message);
  }
}

export async function saveNewsItems(sweepId, items) {
  const d = await initDb();
  if (!d || !items?.length) return;
  try {
    const stmt = d.prepare(`
      INSERT INTO news_items (sweep_id, source, title, summary, url, series, region, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = d.transaction((rows) => {
      for (const row of rows) {
        stmt.run(sweepId, row.source, row.title, row.summary || null, row.url || null, row.series || null, row.region || null, row.publishedAt || null);
      }
    });
    tx(items.slice(0, 200).map(item => ({
      source: item.source || 'Unknown',
      title: item.title || item.headline || '',
      summary: item.summary || '',
      url: item.url || null,
      series: item.series || null,
      region: item.region || null,
      publishedAt: item.publishedAt || item.timestamp || null,
    })));
  } catch (e) {
    console.error('[DB] saveNewsItems error:', e.message);
  }
}

// === Flight cache ===

export async function getFlightCache(date) {
  const d = await initDb();
  if (!d) return null;
  try {
    const row = d.prepare('SELECT data_json FROM flight_cache WHERE cache_date = ? ORDER BY id DESC LIMIT 1').get(date);
    return row ? JSON.parse(row.data_json) : null;
  } catch (e) {
    console.error('[DB] getFlightCache error:', e.message);
    return null;
  }
}

export async function saveFlightCache(date, source, data) {
  const d = await initDb();
  if (!d) return;
  try {
    const existing = d.prepare('SELECT id FROM flight_cache WHERE cache_date = ?').get(date);
    if (existing) {
      d.prepare('UPDATE flight_cache SET data_json = ?, source = ?, created_at = datetime(\'now\') WHERE id = ?')
        .run(JSON.stringify(data), source, existing.id);
    } else {
      d.prepare('INSERT INTO flight_cache (cache_date, source, data_json) VALUES (?, ?, ?)')
        .run(date, source, JSON.stringify(data));
    }
  } catch (e) {
    console.error('[DB] saveFlightCache error:', e.message);
  }
}

// === History queries ===

export async function getRecentSweeps(limit = 20) {
  const d = await initDb();
  if (!d) return [];
  try {
    return d.prepare('SELECT * FROM sweep_runs ORDER BY id DESC LIMIT ?').all(limit);
  } catch { return []; }
}

export async function getSectionHistory(section, limit = 10) {
  const d = await initDb();
  if (!d) return [];
  try {
    return d.prepare(`
      SELECT ss.*, sr.timestamp AS sweep_timestamp
      FROM section_snapshots ss
      JOIN sweep_runs sr ON sr.id = ss.sweep_id
      WHERE ss.section = ?
      ORDER BY ss.id DESC LIMIT ?
    `).all(section, limit);
  } catch { return []; }
}

export async function getNewsHistory(opts = {}) {
  const d = await initDb();
  if (!d) return [];
  try {
    let sql = 'SELECT * FROM news_items WHERE 1=1';
    const params = [];
    if (opts.source) { sql += ' AND source = ?'; params.push(opts.source); }
    if (opts.since) { sql += ' AND published_at >= ?'; params.push(opts.since); }
    if (opts.search) { sql += ' AND title LIKE ?'; params.push(`%${opts.search}%`); }
    sql += ' ORDER BY published_at DESC LIMIT ?';
    params.push(opts.limit || 50);
    return d.prepare(sql).all(...params);
  } catch { return []; }
}

export async function cleanOldData(daysToKeep = 30) {
  const d = await initDb();
  if (!d) return;
  try {
    const cutoff = new Date(Date.now() - daysToKeep * 86400000).toISOString();
    d.prepare('DELETE FROM news_items WHERE created_at < ?').run(cutoff);
    d.prepare('DELETE FROM section_snapshots WHERE created_at < ?').run(cutoff);
    d.prepare('DELETE FROM source_data WHERE created_at < ?').run(cutoff);
    const oldSweeps = d.prepare('SELECT id FROM sweep_runs WHERE created_at < ?').all(cutoff);
    if (oldSweeps.length) {
      d.prepare(`DELETE FROM sweep_runs WHERE id IN (${oldSweeps.map(() => '?').join(',')})`).run(...oldSweeps.map(r => r.id));
    }
    console.error(`[DB] Cleaned data older than ${daysToKeep} days`);
  } catch (e) {
    console.error('[DB] cleanOldData error:', e.message);
  }
}
