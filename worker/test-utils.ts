import { applyD1Migrations, env } from 'cloudflare:test'
import migrationSql from '../migrations/0001_initial_schema.sql?raw'

export async function migrateTestDatabase(): Promise<void> {
  await applyD1Migrations(env.DB, [{
    name: '0001_initial_schema',
    queries: migrationSql.split(';').map((query) => query.trim()).filter(Boolean),
  }])
}
