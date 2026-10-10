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
  CREATE TABLE IF NOT EXISTS brainstorm_sessions (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS brainstorm_board_idx ON brainstorm_sessions(board_id, updated_at);
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    spec_version TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    board_id TEXT,
    moderator_id TEXT NOT NULL DEFAULT 'human-facilitator',
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
    status TEXT NOT NULL DEFAULT 'active',
    joined_at TEXT,
    last_seen_at TEXT,
    lease_expires_at TEXT,
    watching_element_ids_json TEXT,
    color TEXT,
    focus_json TEXT,
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
    metadata_json TEXT,
    checkpoint_json TEXT
  );
  CREATE INDEX IF NOT EXISTS events_session_sequence_idx ON events(session_id, sequence);
  CREATE TABLE IF NOT EXISTS murals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    board_json TEXT NOT NULL,
    owner_token_hash TEXT NOT NULL,
    user_token_hash TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mural_invites (
    id TEXT PRIMARY KEY,
    mural_id TEXT NOT NULL REFERENCES murals(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    specialty TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    redeemed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS mural_invites_mural_idx ON mural_invites(mural_id);
  CREATE TABLE IF NOT EXISTS mural_focus_claims (
    mural_id TEXT NOT NULL REFERENCES murals(id) ON DELETE CASCADE,
    element_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    participant_name TEXT NOT NULL,
    color TEXT,
    state TEXT NOT NULL,
    intent TEXT NOT NULL,
    claimed_at TEXT NOT NULL,
    lease_expires_at TEXT NOT NULL,
    release_on_action TEXT NOT NULL,
    PRIMARY KEY (mural_id, element_id)
  );
  CREATE INDEX IF NOT EXISTS mural_focus_expiry_idx ON mural_focus_claims(mural_id, lease_expires_at);
`)

const participantColumns = sqlite.prepare('PRAGMA table_info(participants)').all() as Array<{ name: string }>
if (!participantColumns.some((column) => column.name === 'sequence')) {
  sqlite.exec('ALTER TABLE participants ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0')
}
if (!participantColumns.some((column) => column.name === 'status')) sqlite.exec("ALTER TABLE participants ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
if (!participantColumns.some((column) => column.name === 'joined_at')) sqlite.exec('ALTER TABLE participants ADD COLUMN joined_at TEXT')
if (!participantColumns.some((column) => column.name === 'last_seen_at')) sqlite.exec('ALTER TABLE participants ADD COLUMN last_seen_at TEXT')
if (!participantColumns.some((column) => column.name === 'lease_expires_at')) sqlite.exec('ALTER TABLE participants ADD COLUMN lease_expires_at TEXT')
if (!participantColumns.some((column) => column.name === 'watching_element_ids_json')) sqlite.exec('ALTER TABLE participants ADD COLUMN watching_element_ids_json TEXT')
if (!participantColumns.some((column) => column.name === 'color')) sqlite.exec('ALTER TABLE participants ADD COLUMN color TEXT')
if (!participantColumns.some((column) => column.name === 'focus_json')) sqlite.exec('ALTER TABLE participants ADD COLUMN focus_json TEXT')

const sessionColumns = sqlite.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
if (!sessionColumns.some((column) => column.name === 'board_id')) sqlite.exec('ALTER TABLE sessions ADD COLUMN board_id TEXT')
if (!sessionColumns.some((column) => column.name === 'moderator_id')) sqlite.exec("ALTER TABLE sessions ADD COLUMN moderator_id TEXT NOT NULL DEFAULT 'human-facilitator'")

const eventColumns = sqlite.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>
if (!eventColumns.some((column) => column.name === 'checkpoint_json')) sqlite.exec('ALTER TABLE events ADD COLUMN checkpoint_json TEXT')

export const db = drizzle(sqlite, { schema })
export { databasePath }
