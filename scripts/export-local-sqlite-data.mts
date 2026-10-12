import Database from 'better-sqlite3'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const tables = [
  { name: 'sessions', columns: ['id', 'spec_version', 'title', 'status', 'started_at', 'board_id', 'moderator_id', 'completed_at', 'final_output', 'board_json', 'updated_at'] },
  { name: 'participants', columns: ['session_id', 'id', 'sequence', 'name', 'role', 'specialty', 'status', 'joined_at', 'last_seen_at', 'lease_expires_at', 'watching_element_ids_json', 'color', 'focus_json'] },
  { name: 'events', columns: ['id', 'session_id', 'sequence', 'created_at', 'participant_id', 'participant_name', 'participant_role', 'kind', 'content', 'reply_to', 'related_element_ids_json', 'metadata_json', 'checkpoint_json'] },
  { name: 'murals', columns: ['id', 'name', 'board_json', 'owner_token_hash', 'user_token_hash', 'revision', 'created_at', 'updated_at'] },
  { name: 'mural_invites', columns: ['id', 'mural_id', 'token_hash', 'agent_id', 'agent_name', 'specialty', 'status', 'created_at', 'redeemed_at'] },
  { name: 'mural_focus_claims', columns: ['mural_id', 'element_id', 'participant_id', 'participant_name', 'color', 'state', 'intent', 'claimed_at', 'lease_expires_at', 'release_on_action'] },
  { name: 'brainstorm_sessions', columns: ['id', 'board_id', 'payload_json', 'updated_at'] },
] as const

export type ExportSummary = { counts: Record<(typeof tables)[number]['name'], number> }

function quoteIdentifier(value: string) { return `"${value.replaceAll('"', '""')}"` }

function quoteValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('源数据库包含不可导出的数字。')
    return String(value)
  }
  if (typeof value === 'bigint') return String(value)
  if (value instanceof Uint8Array) return `X'${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}'`
  return `'${String(value).replaceAll("'", "''")}'`
}

export async function exportD1Data(sourcePath: string, outputPath: string): Promise<ExportSummary> {
  if (!sourcePath.trim() || !outputPath.trim()) throw new Error('源数据库路径和输出路径不能为空。')
  const source = resolve(sourcePath)
  const output = resolve(outputPath)
  if (source === output) throw new Error('输出文件不能覆盖源数据库。')
  if (!existsSync(source)) throw new Error(`源数据库不存在：${source}`)

  const database = new Database(source, { readonly: true, fileMustExist: true })
  const statements: string[] = []
  const counts = {} as ExportSummary['counts']
  try {
    database.pragma('query_only = ON')
    for (const table of tables) {
      const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table.name)
      if (!exists) throw new Error(`源数据库缺少业务表：${table.name}`)
      const rows = database.prepare(`SELECT ${table.columns.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(table.name)}`).all() as Array<Record<string, unknown>>
      counts[table.name] = rows.length
      const fields = table.columns.map(quoteIdentifier).join(', ')
      rows.forEach((row) => {
        const values = table.columns.map((column) => quoteValue(row[column])).join(', ')
        statements.push(`INSERT INTO ${quoteIdentifier(table.name)} (${fields}) VALUES (${values});`)
      })
    }
  } finally {
    database.close()
  }

  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, statements.length ? `${statements.join('\n')}\n` : '', 'utf8')
  return { counts }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [sourcePath, outputPath] = process.argv.slice(2)
  if (!sourcePath || !outputPath) {
    console.error('用法：tsx scripts/export-local-sqlite-data.mts <源数据库> <输出 SQL>')
    process.exitCode = 2
  } else {
    exportD1Data(sourcePath, outputPath).then((summary) => {
      console.log(JSON.stringify(summary))
    }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
  }
}
