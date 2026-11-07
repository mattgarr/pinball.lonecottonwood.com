import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../data.db');

export const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA foreign_keys = ON;`);

db.exec(`
  CREATE TABLE IF NOT EXISTS party (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS machines (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    year INTEGER,
    manufacturer TEXT,
    display_type TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '🎯',
    avatar TEXT,
    team_id INTEGER NOT NULL REFERENCES teams(id),
    first_timer INTEGER NOT NULL DEFAULT 0,
    session_token TEXT NOT NULL UNIQUE,
    joined_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id),
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    value INTEGER NOT NULL,
    ai_extracted INTEGER NOT NULL DEFAULT 0,
    voided INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_scores_machine ON scores(machine_id) WHERE voided = 0;
  CREATE INDEX IF NOT EXISTS idx_scores_player  ON scores(player_id)  WHERE voided = 0;
`);

// Migration: add avatar column to a players table created before avatars existed.
try { db.exec(`ALTER TABLE players ADD COLUMN avatar TEXT`); } catch { /* column already exists */ }

// Seed party / teams / machines from config (idempotent).
const seedParty = db.prepare(`INSERT OR IGNORE INTO party (id, name) VALUES (1, ?)`);
seedParty.run(config.party.name);

const seedTeam = db.prepare(`INSERT OR IGNORE INTO teams (id, name, color) VALUES (?, ?, ?)`);
for (const t of config.teams) seedTeam.run(t.id, t.name, t.color);

const seedMachine = db.prepare(`
  INSERT OR IGNORE INTO machines (id, name, year, manufacturer, display_type, sort_order)
  VALUES (?, ?, ?, ?, ?, ?)
`);
config.machines.forEach((m, i) => {
  seedMachine.run(m.id, m.name, m.year ?? null, m.manufacturer ?? null, m.displayType ?? null, i);
});
