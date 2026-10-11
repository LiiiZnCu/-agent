import { expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

it('旧会话迁移不生成默认主持人身份', async () => {
  const databasePath = join(mkdtempSync(join(tmpdir(), 'mural-db-migration-')), 'legacy.sqlite')
  const legacy = new Database(databasePath)
  legacy.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, spec_version TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, final_output TEXT, board_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO sessions VALUES ('old', '1.0', '旧记录', 'recording', '2026-10-10T00:00:00.000Z', NULL, NULL, '{}', '2026-10-10T00:00:00.000Z');`)
  legacy.close()
  const previous = process.env.CANVAS_RELAY_DB_PATH
  process.env.CANVAS_RELAY_DB_PATH = databasePath
  try {
    vi.resetModules()
    await import('./db')
    const migrated = new Database(databasePath)
    expect(migrated.prepare('SELECT moderator_id FROM sessions WHERE id = ?').get('old')).toEqual({ moderator_id: null })
    migrated.close()
  } finally {
    if (previous === undefined) delete process.env.CANVAS_RELAY_DB_PATH
    else process.env.CANVAS_RELAY_DB_PATH = previous
  }
})
