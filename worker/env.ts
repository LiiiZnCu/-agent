import type { D1Database, Fetcher } from '@cloudflare/workers-types'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  DEEPSEEK_API_KEY?: string
  DEEPSEEK_BASE_URL?: string
  DEEPSEEK_MODEL?: string
}
