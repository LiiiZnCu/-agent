import { and, eq, inArray, lt } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'

import type { AgentFocus, BoardSnapshot, MuralFocusClaim, RecordingParticipant } from '../src/types'
import type { Database } from './db'
import { createToken, hashToken, sameTokenHash } from './crypto'
import { muralFocusClaims, muralInvites, murals } from './schema'

export type HostedGuest = { agentId: string; agentName: string; specialty?: string }
const agentColors = new Set(['coral', 'blue', 'violet', 'green', 'amber', 'pink', 'cyan', 'lime'])

function cleanGuest(value: HostedGuest): HostedGuest {
  if (!value || typeof value.agentId !== 'string' || typeof value.agentName !== 'string') throw new Error('Every guest needs agentId and agentName.')
  const agentId = value.agentId.trim().slice(0, 80)
  const agentName = value.agentName.trim().slice(0, 80)
  if (!agentId || !agentName) throw new Error('Every guest needs agentId and agentName.')
  return { agentId, agentName, specialty: value.specialty?.trim().slice(0, 120) }
}

export function createHostedStore(db: Database) {
  async function findInvite(muralId: string, rawToken: string) {
    const hash = await hashToken(rawToken)
    return db.select().from(muralInvites).where(and(eq(muralInvites.muralId, muralId), eq(muralInvites.tokenHash, hash))).get()
  }

  async function accessRole(mural: typeof murals.$inferSelect, rawToken: string) {
    const hash = await hashToken(rawToken)
    if (sameTokenHash(hash, mural.ownerTokenHash)) return 'owner' as const
    if (sameTokenHash(hash, mural.userTokenHash)) return 'user' as const
    const invite = await findInvite(mural.id, rawToken)
    if (invite?.status === 'active') return 'agent' as const
    return null
  }

  async function accessIdentity(mural: typeof murals.$inferSelect, rawToken: string) {
    const role = await accessRole(mural, rawToken)
    if (!role) return null
    const invite = role === 'agent' ? await findInvite(mural.id, rawToken) : null
    return { role, agentId: invite?.agentId }
  }

  async function pruneFocus(muralId: string, now = new Date().toISOString()) {
    await db.delete(muralFocusClaims).where(and(eq(muralFocusClaims.muralId, muralId), lt(muralFocusClaims.leaseExpiresAt, now))).run()
  }

  async function focusRows(muralId: string): Promise<MuralFocusClaim[]> {
    await pruneFocus(muralId)
    const rows = await db.select().from(muralFocusClaims).where(eq(muralFocusClaims.muralId, muralId)).all()
    const claims = new Map<string, MuralFocusClaim>()
    rows.forEach((row) => {
      const existing = claims.get(row.participantId)
      if (existing) {
        existing.elementIds.push(row.elementId)
        return
      }
      claims.set(row.participantId, {
        participantId: row.participantId,
        participantName: row.participantName,
        color: (row.color ?? undefined) as MuralFocusClaim['color'],
        state: row.state as AgentFocus['state'],
        intent: row.intent,
        elementIds: [row.elementId],
        claimedAt: row.claimedAt,
        leaseExpiresAt: row.leaseExpiresAt,
        releaseOnAction: row.releaseOnAction as AgentFocus['releaseOnAction'],
      })
    })
    return [...claims.values()]
  }

  async function requireFocusIdentity(mural: typeof murals.$inferSelect, rawToken: string, participantId: string) {
    const identity = await accessIdentity(mural, rawToken)
    if (!identity) throw new Error('Invalid or revoked mural access capability.')
    if (identity.role === 'user') throw new Error('Human collaborator links cannot claim agent focus.')
    if (identity.role === 'agent' && identity.agentId !== participantId) throw new Error('This agent invitation belongs to a different participant.')
  }

  function nodeVersion(node: BoardSnapshot['nodes'][number]) {
    return typeof node.data._syncVersion === 'string' ? node.data._syncVersion : ''
  }

  function edgeVersion(edge: BoardSnapshot['edges'][number]) {
    const data = edge.data as Record<string, unknown> | undefined
    return typeof data?._syncVersion === 'string' ? data._syncVersion : ''
  }

  function mergeVersionMaps(left: Record<string, string> = {}, right: Record<string, string> = {}) {
    const merged = { ...left }
    Object.entries(right).forEach(([id, version]) => {
      if (!merged[id] || version > merged[id]) merged[id] = version
    })
    return merged
  }

  function mergeBoard(current: BoardSnapshot, incoming: BoardSnapshot): BoardSnapshot {
    const nodeTombstones = mergeVersionMaps(current.sync?.nodeTombstones, incoming.sync?.nodeTombstones)
    const edgeTombstones = mergeVersionMaps(current.sync?.edgeTombstones, incoming.sync?.edgeTombstones)
    const nodes = new Map(current.nodes.map((node) => [node.id, node]))
    incoming.nodes.forEach((node) => {
      const existing = nodes.get(node.id)
      if (!existing || nodeVersion(node) >= nodeVersion(existing)) nodes.set(node.id, node)
    })
    Object.entries(nodeTombstones).forEach(([id, deletedAt]) => {
      const node = nodes.get(id)
      if (!node || deletedAt >= nodeVersion(node)) nodes.delete(id)
    })
    const edges = new Map(current.edges.map((edge) => [edge.id, edge]))
    incoming.edges.forEach((edge) => {
      const existing = edges.get(edge.id)
      if (!existing || edgeVersion(edge) >= edgeVersion(existing)) edges.set(edge.id, edge)
    })
    Object.entries(edgeTombstones).forEach(([id, deletedAt]) => {
      const edge = edges.get(id)
      if (!edge || deletedAt >= edgeVersion(edge)) edges.delete(id)
    })
    return { ...incoming, nodes: [...nodes.values()], edges: [...edges.values()].filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)), sync: { nodeTombstones, edgeTombstones } }
  }

  async function createMural(name: string, publicBase: string, initialBoard?: BoardSnapshot) {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const ownerToken = createToken()
    const userToken = createToken()
    if (initialBoard && (!Array.isArray(initialBoard.nodes) || !Array.isArray(initialBoard.edges))) throw new Error('A valid board snapshot is required.')
    const board: BoardSnapshot = { id, name: name.trim().slice(0, 80) || 'Untitled brainstorm', nodes: initialBoard ? structuredClone(initialBoard.nodes) : [], edges: initialBoard ? structuredClone(initialBoard.edges) : [], createdAt: now, updatedAt: now }
    await db.insert(murals).values({ id, name: board.name, boardJson: JSON.stringify(board), ownerTokenHash: await hashToken(ownerToken), userTokenHash: await hashToken(userToken), revision: 1, createdAt: now, updatedAt: now }).run()
    return { board, revision: 1, ownerToken, userToken, ownerUrl: `${publicBase}/?mural=${encodeURIComponent(id)}#owner=${encodeURIComponent(ownerToken)}`, userUrl: `${publicBase}/?mural=${encodeURIComponent(id)}#access=${encodeURIComponent(userToken)}` }
  }

  async function getMural(id: string, rawToken: string) {
    const mural = await db.select().from(murals).where(eq(murals.id, id)).get()
    if (!mural) return null
    const role = await accessRole(mural, rawToken)
    if (!role) throw new Error('Invalid or revoked mural access capability.')
    return { board: JSON.parse(mural.boardJson) as BoardSnapshot, revision: mural.revision, role, focusClaims: await focusRows(id) }
  }

  async function rotateUserShare(id: string, rawToken: string, publicBase: string) {
    const mural = await db.select().from(murals).where(eq(murals.id, id)).get()
    if (!mural) return null
    if (await accessRole(mural, rawToken) !== 'owner') throw new Error('Only the mural owner can create collaborator links.')
    const userToken = createToken()
    await db.update(murals).set({ userTokenHash: await hashToken(userToken), updatedAt: new Date().toISOString() }).where(eq(murals.id, id)).run()
    return { userToken, userUrl: `${publicBase}/?mural=${encodeURIComponent(id)}#access=${encodeURIComponent(userToken)}` }
  }

  async function setFocus(id: string, rawToken: string, participant: Pick<RecordingParticipant, 'id' | 'name' | 'color'>, focus: AgentFocus | null) {
    const mural = await db.select().from(murals).where(eq(murals.id, id)).get()
    if (!mural) return null
    await requireFocusIdentity(mural, rawToken, participant.id)
    if (!focus) {
      await db.delete(muralFocusClaims).where(and(eq(muralFocusClaims.muralId, id), eq(muralFocusClaims.participantId, participant.id))).run()
      return focusRows(id)
    }
    if ((focus.state !== 'editing' && focus.state !== 'reviewing') || typeof focus.intent !== 'string' || !Array.isArray(focus.elementIds)
      || !Number.isFinite(Date.parse(focus.claimedAt)) || !Number.isFinite(Date.parse(focus.leaseExpiresAt))
      || (focus.releaseOnAction !== 'after_write' && focus.releaseOnAction !== 'manual')) throw new Error('A valid focus lease is required.')
    if (participant.color !== undefined && !agentColors.has(participant.color)) throw new Error('Unknown agent color.')
    if (!focus.elementIds.length || focus.elementIds.length > 50) throw new Error('Focus requires between 1 and 50 element IDs.')
    const board = JSON.parse(mural.boardJson) as BoardSnapshot
    const validIds = new Set(board.nodes.map((node) => node.id))
    const elementIds = [...new Set(focus.elementIds)]
    if (elementIds.some((elementId) => !validIds.has(elementId))) throw new Error('Focus references an element that does not exist.')
    await pruneFocus(id)
    const conflicts = await db.select().from(muralFocusClaims).where(and(eq(muralFocusClaims.muralId, id), inArray(muralFocusClaims.elementId, elementIds))).all()
    const conflict = conflicts.find((claim) => claim.participantId !== participant.id && claim.state === 'editing' && focus.state === 'editing')
    if (conflict) throw new Error(`${conflict.participantName} is already editing one of those elements until ${conflict.leaseExpiresAt}.`)
    const statements: BatchItem<'sqlite'>[] = [db.delete(muralFocusClaims).where(and(eq(muralFocusClaims.muralId, id), eq(muralFocusClaims.participantId, participant.id))) as BatchItem<'sqlite'>]
    statements.push(...elementIds.map((elementId) => db.insert(muralFocusClaims).values({ muralId: id, elementId, participantId: participant.id, participantName: participant.name.trim().slice(0, 80), color: participant.color ?? null, state: focus.state, intent: focus.intent.trim().slice(0, 240), claimedAt: focus.claimedAt, leaseExpiresAt: focus.leaseExpiresAt, releaseOnAction: focus.releaseOnAction }) as BatchItem<'sqlite'>))
    await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
    return focusRows(id)
  }

  async function assertWritable(id: string, rawToken: string, participantId: string, elementIds: string[]) {
    const mural = await db.select().from(murals).where(eq(murals.id, id)).get()
    if (!mural) return null
    await requireFocusIdentity(mural, rawToken, participantId)
    await pruneFocus(id)
    const ids = [...new Set(elementIds)]
    const rows = ids.length ? await db.select().from(muralFocusClaims).where(and(eq(muralFocusClaims.muralId, id), inArray(muralFocusClaims.elementId, ids))).all() : []
    const conflict = rows.find((claim) => claim.participantId !== participantId && claim.state === 'editing')
    if (conflict) throw new Error(`${conflict.participantName} is editing ${conflict.elementId} until ${conflict.leaseExpiresAt}.`)
    return true
  }

  async function authorize(id: string, rawToken: string) {
    const mural = await db.select().from(murals).where(eq(murals.id, id)).get()
    if (!mural) return null
    const role = await accessRole(mural, rawToken)
    if (!role) throw new Error('Invalid or revoked mural access capability.')
    return role
  }

  async function saveMural(id: string, rawToken: string, board: BoardSnapshot) {
    const mural = await db.select().from(murals).where(eq(murals.id, id)).get()
    if (!mural) return null
    if (!await accessRole(mural, rawToken)) throw new Error('Invalid or revoked mural access capability.')
    if (!board || board.id !== id || !Array.isArray(board.nodes) || !Array.isArray(board.edges)) throw new Error('A valid matching board snapshot is required.')
    const now = new Date().toISOString()
    const revision = mural.revision + 1
    const saved = { ...mergeBoard(JSON.parse(mural.boardJson) as BoardSnapshot, board), name: board.name.trim().slice(0, 80) || 'Untitled brainstorm', updatedAt: now }
    await db.update(murals).set({ name: saved.name, boardJson: JSON.stringify(saved), revision, updatedAt: now }).where(eq(murals.id, id)).run()
    return { board: saved, revision }
  }

  async function createInvites(id: string, ownerToken: string, guests: HostedGuest[], publicBase: string) {
    const mural = await db.select().from(murals).where(eq(murals.id, id)).get()
    if (!mural) return null
    if (await accessRole(mural, ownerToken) !== 'owner') throw new Error('Only the mural owner can create agent invitations.')
    if (!Array.isArray(guests) || guests.length < 1 || guests.length > 20) throw new Error('Create between 1 and 20 invitations at a time.')
    const seen = new Set<string>()
    const now = new Date().toISOString()
    const invitations = []
    for (const rawGuest of guests) {
      const guest = cleanGuest(rawGuest)
      if (seen.has(guest.agentId)) throw new Error(`Duplicate agentId ${guest.agentId}.`)
      seen.add(guest.agentId)
      const inviteToken = createToken()
      const inviteId = crypto.randomUUID()
      await db.insert(muralInvites).values({ id: inviteId, muralId: id, tokenHash: await hashToken(inviteToken), agentId: guest.agentId, agentName: guest.agentName, specialty: guest.specialty ?? null, status: 'active', createdAt: now, redeemedAt: null }).run()
      invitations.push({ inviteId, ...guest, inviteToken, agentUrl: `${publicBase}/?mural=${encodeURIComponent(id)}#invite=${encodeURIComponent(inviteToken)}` })
    }
    return invitations
  }

  async function redeemInvite(id: string, inviteToken: string) {
    const invite = await findInvite(id, inviteToken)
    if (!invite || invite.status !== 'active') throw new Error('Invalid or revoked agent invitation.')
    const redeemedAt = new Date().toISOString()
    await db.update(muralInvites).set({ redeemedAt }).where(eq(muralInvites.id, invite.id)).run()
    return { inviteId: invite.id, muralId: invite.muralId, agentId: invite.agentId, agentName: invite.agentName, specialty: invite.specialty ?? undefined, redeemedAt }
  }

  return { createMural, getMural, rotateUserShare, setFocus, assertWritable, authorize, saveMural, createInvites, redeemInvite }
}
