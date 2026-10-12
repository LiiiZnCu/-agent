import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'

import type { BoardSnapshot } from '../src/types'
import { createDatabase } from './db'
import { createHostedStore } from './hosted-store'
import { migrateTestDatabase } from './test-utils'

const timestamp = '2026-10-10T10:00:00.000Z'
const board: BoardSnapshot = {
  id: 'initial-board', name: '初始白板', createdAt: timestamp, updatedAt: timestamp, edges: [],
  nodes: [{ id: 'node-a', type: 'boardElement', position: { x: 0, y: 0 }, data: { title: '观点', body: '', kind: 'idea', color: 'paper', votes: 0 } }],
}

const store = createHostedStore(createDatabase(env.DB))

beforeAll(() => migrateTestDatabase())

describe('D1 托管白板存储', () => {
  it('验证令牌、邀请、焦点冲突和释放', async () => {
    const mural = await store.createMural('托管测试', 'https://example.test', board)
    await expect(store.getMural(mural.board.id, 'wrong-token')).rejects.toThrow('Invalid or revoked')
    await expect(store.getMural(mural.board.id, mural.ownerToken)).resolves.toMatchObject({ role: 'owner', revision: 1 })

    const invitations = await store.createInvites(mural.board.id, mural.ownerToken, [{ agentId: 'agent-a', agentName: '代理 A' }], 'https://example.test')
    const participant = await store.redeemInvite(mural.board.id, invitations[0].inviteToken)
    expect(participant.agentId).toBe('agent-a')

    const focus = { state: 'editing' as const, intent: '编辑观点', elementIds: ['node-a'], claimedAt: '2030-01-01T10:00:00.000Z', leaseExpiresAt: '2030-01-01T10:10:00.000Z', releaseOnAction: 'manual' as const }
    await expect(store.setFocus(mural.board.id, invitations[0].inviteToken, { id: 'agent-a', name: '代理 A', color: 'cyan' }, focus)).resolves.toHaveLength(1)
    await expect(store.setFocus(mural.board.id, mural.userToken, { id: 'human', name: '人类' }, focus)).rejects.toThrow('cannot claim agent focus')
    await expect(store.assertWritable(mural.board.id, invitations[0].inviteToken, 'agent-b', ['node-a'])).rejects.toThrow('different participant')
    await expect(store.setFocus(mural.board.id, invitations[0].inviteToken, { id: 'agent-a', name: '代理 A', color: 'cyan' }, null)).resolves.toEqual([])
  })
})
