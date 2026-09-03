import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { and, eq, inArray, lt } from 'drizzle-orm'
import type { AgentFocus, BoardSnapshot, MuralFocusClaim, RecordingParticipant } from '../src/types.ts'
import { db } from './db.ts'
import { muralFocusClaims, muralInvites, murals } from './schema.ts'

export type HostedGuest = { agentId: string; agentName: string; specialty?: string }
const agentColors = new Set(['coral', 'blue', 'violet', 'green', 'amber', 'pink', 'cyan', 'lime'])

function token() {
  return randomBytes(24).toString('base64url')
}

function tokenHash(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

function sameHash(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function cleanGuest(value: HostedGuest): HostedGuest {
  if (!value || typeof value.agentId !== 'string' || typeof value.agentName !== 'string') throw new Error('Every guest needs agentId and agentName.')
  const agentId = value.agentId.trim().slice(0, 80)
  const agentName = value.agentName.trim().slice(0, 80)
  if (!agentId || !agentName) throw new Error('Every guest needs agentId and agentName.')
  return { agentId, agentName, specialty: value.specialty?.trim().slice(0, 120) }
}

function findInvite(muralId: string, rawToken: string) {
  const hash = tokenHash(rawToken)
  return db.select().from(muralInvites).where(and(eq(muralInvites.muralId, muralId), eq(muralInvites.tokenHash, hash))).get()
}

function accessRole(mural: typeof murals.$inferSelect, rawToken: string) {
  const hash = tokenHash(rawToken)
  if (sameHash(hash, mural.ownerTokenHash)) return 'owner' as const
  if (sameHash(hash, mural.userTokenHash)) return 'user' as const
  const invite = findInvite(mural.id, rawToken)
  if (invite?.status === 'active') return 'agent' as const
  return null
}

function accessIdentity(mural: typeof murals.$inferSelect, rawToken: string) {
  const role = accessRole(mural, rawToken)
  if (!role) return null
  const invite = role === 'agent' ? findInvite(mural.id, rawToken) : null
  return { role, agentId: invite?.agentId }
}

function pruneFocus(muralId: string, now = new Date().toISOString()) {
  db.delete(muralFocusClaims).where(and(eq(muralFocusClaims.muralId, muralId), lt(muralFocusClaims.leaseExpiresAt, now))).run()
}

function focusRows(muralId: string): MuralFocusClaim[] {
  pruneFocus(muralId)
  const rows = db.select().from(muralFocusClaims).where(eq(muralFocusClaims.muralId, muralId)).all()
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

function requireFocusIdentity(mural: typeof murals.$inferSelect, rawToken: string, participantId: string) {
  const identity = accessIdentity(mural, rawToken)
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
  return {
    ...incoming,
    nodes: [...nodes.values()],
    edges: [...edges.values()].filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)),
    sync: { nodeTombstones, edgeTombstones },
  }
}

export function createHostedMural(name: string, publicBase: string, initialBoard?: BoardSnapshot) {
  const now = new Date().toISOString()
  const id = randomUUID()
  const ownerToken = token()
  const userToken = token()
  if (initialBoard && (!Array.isArray(initialBoard.nodes) || !Array.isArray(initialBoard.edges))) throw new Error('A valid board snapshot is required.')
  const board: BoardSnapshot = {
    id,
    name: name.trim().slice(0, 80) || 'Untitled brainstorm',
    nodes: initialBoard ? structuredClone(initialBoard.nodes) : [],
    edges: initialBoard ? structuredClone(initialBoard.edges) : [],
    createdAt: now,
    updatedAt: now,
  }
  db.insert(murals).values({
    id,
    name: board.name,
    boardJson: JSON.stringify(board),
    ownerTokenHash: tokenHash(ownerToken),
    userTokenHash: tokenHash(userToken),
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }).run()
  return {
    board,
    revision: 1,
    ownerToken,
    userToken,
    ownerUrl: `${publicBase}/?mural=${encodeURIComponent(id)}#owner=${encodeURIComponent(ownerToken)}`,
    userUrl: `${publicBase}/?mural=${encodeURIComponent(id)}#access=${encodeURIComponent(userToken)}`,
  }
}

export function getHostedMural(id: string, rawToken: string) {
  const mural = db.select().from(murals).where(eq(murals.id, id)).get()
  if (!mural) return null
  const role = accessRole(mural, rawToken)
  if (!role) throw new Error('Invalid or revoked mural access capability.')
  return { board: JSON.parse(mural.boardJson) as BoardSnapshot, revision: mural.revision, role, focusClaims: focusRows(id) }
}

export function rotateHostedUserShare(id: string, rawToken: string, publicBase: string) {
  const mural = db.select().from(murals).where(eq(murals.id, id)).get()
  if (!mural) return null
  if (accessRole(mural, rawToken) !== 'owner') throw new Error('Only the mural owner can create collaborator links.')
  const userToken = token()
  db.update(murals).set({ userTokenHash: tokenHash(userToken), updatedAt: new Date().toISOString() }).where(eq(murals.id, id)).run()
  return { userToken, userUrl: `${publicBase}/?mural=${encodeURIComponent(id)}#access=${encodeURIComponent(userToken)}` }
}

export function setHostedFocus(id: string, rawToken: string, participant: Pick<RecordingParticipant, 'id' | 'name' | 'color'>, focus: AgentFocus | null) {
  const mural = db.select().from(murals).where(eq(murals.id, id)).get()
  if (!mural) return null
  requireFocusIdentity(mural, rawToken, participant.id)
  if (!focus) {
    db.delete(muralFocusClaims).where(and(eq(muralFocusClaims.muralId, id), eq(muralFocusClaims.participantId, participant.id))).run()
    return focusRows(id)
  }
  if ((focus.state !== 'editing' && focus.state !== 'reviewing')
    || typeof focus.intent !== 'string'
    || !Array.isArray(focus.elementIds)
    || !Number.isFinite(Date.parse(focus.claimedAt))
    || !Number.isFinite(Date.parse(focus.leaseExpiresAt))
    || (focus.releaseOnAction !== 'after_write' && focus.releaseOnAction !== 'manual')) throw new Error('A valid focus lease is required.')
  if (participant.color !== undefined && !agentColors.has(participant.color)) throw new Error('Unknown agent color.')
  if (!focus.elementIds.length || focus.elementIds.length > 50) throw new Error('Focus requires between 1 and 50 element IDs.')
  const board = JSON.parse(mural.boardJson) as BoardSnapshot
  const validIds = new Set(board.nodes.map((node) => node.id))
  const elementIds = [...new Set(focus.elementIds)]
  if (elementIds.some((elementId) => !validIds.has(elementId))) throw new Error('Focus references an element that does not exist.')
  return db.transaction((tx) => {
    const now = new Date().toISOString()
    tx.delete(muralFocusClaims).where(and(eq(muralFocusClaims.muralId, id), lt(muralFocusClaims.leaseExpiresAt, now))).run()
    const conflicts = tx.select().from(muralFocusClaims).where(and(eq(muralFocusClaims.muralId, id), inArray(muralFocusClaims.elementId, elementIds))).all()
      .filter((claim) => claim.participantId !== participant.id && claim.state === 'editing' && focus.state === 'editing')
    if (conflicts.length) throw new Error(`${conflicts[0].participantName} is already editing one of those elements until ${conflicts[0].leaseExpiresAt}.`)
    tx.delete(muralFocusClaims).where(and(eq(muralFocusClaims.muralId, id), eq(muralFocusClaims.participantId, participant.id))).run()
    elementIds.forEach((elementId) => tx.insert(muralFocusClaims).values({
      muralId: id,
      elementId,
      participantId: participant.id,
      participantName: participant.name.trim().slice(0, 80),
      color: participant.color,
      state: focus.state,
      intent: focus.intent.trim().slice(0, 240),
      claimedAt: focus.claimedAt,
      leaseExpiresAt: focus.leaseExpiresAt,
      releaseOnAction: focus.releaseOnAction,
    }).run())
    return focusRows(id)
  })
}

export function assertHostedWritable(id: string, rawToken: string, participantId: string, elementIds: string[]) {
  const mural = db.select().from(murals).where(eq(murals.id, id)).get()
  if (!mural) return null
  requireFocusIdentity(mural, rawToken, participantId)
  pruneFocus(id)
  const ids = [...new Set(elementIds)]
  const rows = ids.length
    ? db.select().from(muralFocusClaims).where(and(eq(muralFocusClaims.muralId, id), inArray(muralFocusClaims.elementId, ids))).all()
    : []
  const conflict = rows.find((claim) => claim.participantId !== participantId && claim.state === 'editing')
  if (conflict) throw new Error(`${conflict.participantName} is editing ${conflict.elementId} until ${conflict.leaseExpiresAt}.`)
  return true
}

export function authorizeHostedMural(id: string, rawToken: string) {
  const mural = db.select().from(murals).where(eq(murals.id, id)).get()
  if (!mural) return null
  const role = accessRole(mural, rawToken)
  if (!role) throw new Error('Invalid or revoked mural access capability.')
  return role
}

export function saveHostedMural(id: string, rawToken: string, board: BoardSnapshot) {
  const mural = db.select().from(murals).where(eq(murals.id, id)).get()
  if (!mural) return null
  if (!accessRole(mural, rawToken)) throw new Error('Invalid or revoked mural access capability.')
  if (!board || board.id !== id || !Array.isArray(board.nodes) || !Array.isArray(board.edges)) throw new Error('A valid matching board snapshot is required.')
  const now = new Date().toISOString()
  const revision = mural.revision + 1
  const saved = {
    ...mergeBoard(JSON.parse(mural.boardJson) as BoardSnapshot, board),
    name: board.name.trim().slice(0, 80) || 'Untitled brainstorm',
    updatedAt: now,
  }
  db.update(murals).set({ name: saved.name, boardJson: JSON.stringify(saved), revision, updatedAt: now }).where(eq(murals.id, id)).run()
  return { board: saved, revision }
}

export function createHostedInvites(id: string, ownerToken: string, guests: HostedGuest[], publicBase: string) {
  const mural = db.select().from(murals).where(eq(murals.id, id)).get()
  if (!mural) return null
  if (accessRole(mural, ownerToken) !== 'owner') throw new Error('Only the mural owner can create agent invitations.')
  if (!Array.isArray(guests) || guests.length < 1 || guests.length > 20) throw new Error('Create between 1 and 20 invitations at a time.')
  const seen = new Set<string>()
  const now = new Date().toISOString()
  return guests.map(cleanGuest).map((guest) => {
    if (seen.has(guest.agentId)) throw new Error(`Duplicate agentId ${guest.agentId}.`)
    seen.add(guest.agentId)
    const inviteToken = token()
    const idValue = randomUUID()
    db.insert(muralInvites).values({
      id: idValue,
      muralId: id,
      tokenHash: tokenHash(inviteToken),
      agentId: guest.agentId,
      agentName: guest.agentName,
      specialty: guest.specialty,
      status: 'active',
      createdAt: now,
    }).run()
    return {
      inviteId: idValue,
      ...guest,
      inviteToken,
      agentUrl: `${publicBase}/?mural=${encodeURIComponent(id)}#invite=${encodeURIComponent(inviteToken)}`,
    }
  })
}

export function redeemHostedInvite(id: string, inviteToken: string) {
  const invite = findInvite(id, inviteToken)
  if (!invite || invite.status !== 'active') throw new Error('Invalid or revoked agent invitation.')
  const redeemedAt = new Date().toISOString()
  db.update(muralInvites).set({ redeemedAt }).where(eq(muralInvites.id, invite.id)).run()
  return {
    inviteId: invite.id,
    muralId: invite.muralId,
    agentId: invite.agentId,
    agentName: invite.agentName,
    specialty: invite.specialty ?? undefined,
    redeemedAt,
  }
}
