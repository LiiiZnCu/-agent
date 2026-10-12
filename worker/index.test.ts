import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('Cloudflare Worker health endpoint', () => {
  it('returns the D1-backed service health', async () => {
    const response = await SELF.fetch('https://example.test/api/health')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, storage: 'd1' })
  })
})
