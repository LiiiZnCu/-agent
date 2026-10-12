import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { exportD1Data } from './export-local-sqlite-data'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

function createSource() {
  const directory = mkdtempSync(join(tmpdir(), 'aimural-export-'))
  directories.push(directory)
  const source = join(directory, 'source.sqlite')
  const db = new Database(source)
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, spec_version TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, board_id TEXT, moderator_id TEXT NOT NULL, completed_at TEXT, final_output TEXT, board_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE participants (session_id TEXT NOT NULL, id TEXT NOT NULL, sequence INTEGER NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, specialty TEXT, status TEXT NOT NULL, joined_at TEXT, last_seen_at TEXT, lease_expires_at TEXT, watching_element_ids_json TEXT, color TEXT, focus_json TEXT, PRIMARY KEY (session_id, id));
    CREATE TABLE events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL, participant_id TEXT NOT NULL, participant_name TEXT NOT NULL, participant_role TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, reply_to TEXT, related_element_ids_json TEXT, metadata_json TEXT, checkpoint_json TEXT);
    CREATE TABLE murals (id TEXT PRIMARY KEY, name TEXT NOT NULL, board_json TEXT NOT NULL, owner_token_hash TEXT NOT NULL, user_token_hash TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE mural_invites (id TEXT PRIMARY KEY, mural_id TEXT NOT NULL, token_hash TEXT NOT NULL, agent_id TEXT NOT NULL, agent_name TEXT NOT NULL, specialty TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, redeemed_at TEXT);
    CREATE TABLE mural_focus_claims (mural_id TEXT NOT NULL, element_id TEXT NOT NULL, participant_id TEXT NOT NULL, participant_name TEXT NOT NULL, color TEXT, state TEXT NOT NULL, intent TEXT NOT NULL, claimed_at TEXT NOT NULL, lease_expires_at TEXT NOT NULL, release_on_action TEXT NOT NULL, PRIMARY KEY (mural_id, element_id));
    CREATE TABLE brainstorm_sessions (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO brainstorm_sessions VALUES ('one', 'board', '{"text":"O''Brien\\n中文"}', '2026-10-10T00:00:00.000Z');
    INSERT INTO brainstorm_sessions VALUES ('two', 'board', '{"text":"第二条"}', '2026-10-10T00:00:01.000Z');
  `)
  db.close()
  return { source, directory }
}

describe('本机 SQLite D1 数据导出', () => {
  it('只输出可执行 INSERT，正确转义文本并返回七张表计数', async () => {
    const { source, directory } = createSource()
    const output = join(directory, 'nested', 'data.sql')
    const summary = await exportD1Data(source, output)
    expect(summary.counts.brainstorm_sessions).toBe(2)
    expect(summary.counts.sessions).toBe(0)
    const sql = readFileSync(output, 'utf8')
    expect(sql).toContain("O''Brien")
    expect(sql).toContain('中文')
    expect(sql).not.toMatch(/CREATE|BEGIN|COMMIT|DEEPSEEK_API_KEY/)
    expect(sql.trim().split('\n')).toHaveLength(2)
  })

  it('缺少业务表或把源文件当输出文件时明确失败', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aimural-export-invalid-'))
    directories.push(directory)
    const source = join(directory, 'source.sqlite')
    const db = new Database(source)
    db.exec('CREATE TABLE other (id TEXT)')
    db.close()
    await expect(exportD1Data(source, join(directory, 'out.sql'))).rejects.toThrow('缺少业务表')
    await expect(exportD1Data(source, source)).rejects.toThrow('输出文件不能覆盖源数据库')
  })
})
