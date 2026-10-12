const base = (process.env.SMOKE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '')

async function check(path: string, expectedContentType: string) {
  const response = await fetch(`${base}${path}`)
  if (!response.ok) throw new Error(`${path} 返回 HTTP ${response.status}。`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes(expectedContentType)) throw new Error(`${path} 的 Content-Type 不是 ${expectedContentType}。`)
  return response
}

try {
  const health = await check('/api/health', 'application/json')
  const payload: unknown = await health.json()
  if (JSON.stringify(payload) !== JSON.stringify({ ok: true, storage: 'd1' })) throw new Error('/api/health 返回内容不正确。')
  await check('/', 'text/html')
  await check('/brainstorm/deep-link', 'text/html')
  console.log(`Worker 冒烟检查通过：${base}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
