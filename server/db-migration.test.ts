import { expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

it('旧会话只从真实参与者恢复主持人，无参与者仍拒绝读取', async () => {
  const databasePath = join(mkdtempSync(join(tmpdir(), 'mural-db-migration-')), 'legacy.sqlite')
  const legacy = new Database(databasePath)
  legacy.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, spec_version TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, final_output TEXT, board_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE participants (session_id TEXT NOT NULL, id TEXT NOT NULL, sequence INTEGER NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, specialty TEXT, PRIMARY KEY (session_id, id));
    INSERT INTO sessions VALUES ('old', '1.0', '旧记录', 'recording', '2026-10-10T00:00:00.000Z', NULL, NULL, '{}', '2026-10-10T00:00:00.000Z');
    INSERT INTO sessions VALUES ('empty', '1.0', '空记录', 'recording', '2026-10-10T00:00:00.000Z', NULL, NULL, '{}', '2026-10-10T00:00:00.000Z');
    INSERT INTO participants VALUES ('old', 'later', 2, '后加入成员', 'human', NULL);
    INSERT INTO participants VALUES ('old', 'earliest', 1, '最早成员', 'human', NULL);`)
  legacy.close()
  const previous = process.env.CANVAS_RELAY_DB_PATH
  process.env.CANVAS_RELAY_DB_PATH = databasePath
  try {
    vi.resetModules()
    await import('./db')
    const migrated = new Database(databasePath)
    expect(migrated.prepare('SELECT moderator_id FROM sessions WHERE id = ?').get('old')).toEqual({ moderator_id: 'earliest' })
    expect(migrated.prepare('SELECT moderator_id FROM sessions WHERE id = ?').get('empty')).toEqual({ moderator_id: null })
    migrated.close()
    const { getSession } = await import('./store')
    expect(getSession('old')?.session.moderatorId).toBe('earliest')
    expect(getSession('empty')).toBeNull()
  } finally {
    if (previous === undefined) delete process.env.CANVAS_RELAY_DB_PATH
    else process.env.CANVAS_RELAY_DB_PATH = previous
  }
})
