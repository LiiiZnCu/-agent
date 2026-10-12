import type { ExportedHandler } from '@cloudflare/workers-types'

import { handleRequest } from './app'
import type { Env } from './env'

const worker = {
  fetch(request, env) {
    return handleRequest(request, env)
  },
} satisfies ExportedHandler<Env>

export default worker
