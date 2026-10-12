import type { Env } from './env'

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/api/health' && request.method === 'GET') {
    return Response.json({ ok: true, storage: 'd1' })
  }

  if (url.pathname.startsWith('/api/')) {
    return Response.json({ error: 'API endpoint not found.' }, { status: 404 })
  }

  return env.ASSETS.fetch(request)
}
