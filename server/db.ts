import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.ts'

const databasePath = process.env.CANVAS_RELAY_DB_PATH || join(process.cwd(), 'data', 'canvas-relay.sqlite')
mkdirSync(dirname(databasePath), { recursive: true })

const sqlite = new Database(databasePath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    spec_version TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    final_output TEXT,
    board_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS participants (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    specialty TEXT,
    PRIMARY KEY (session_id, id)
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    participant_name TEXT NOT NULL,
    participant_role TEXT NOT NULL,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    reply_to TEXT,
    related_element_ids_json TEXT,
    metadata_json TEXT
  );
  CREATE INDEX IF NOT EXISTS events_session_sequence_idx ON events(session_id, sequence);
`)

const participantColumns = sqlite.prepare('PRAGMA table_info(participants)').all() as Array<{ name: string }>
if (!participantColumns.some((column) => column.name === 'sequence')) {
  sqlite.exec('ALTER TABLE participants ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0')
}

export const db = drizzle(sqlite, { schema })
export { databasePath }
