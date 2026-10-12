import { asc, desc, eq } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'

import type { BoardSnapshot, ContributionKind, RecordingParticipant, RecordingSession } from '../src/types'
import type { Database } from './db'
import { events, participants, sessions } from './schema'

export type StoredSession = {
  session: RecordingSession
  finalBoard: BoardSnapshot
}

export function createRecordingStore(db: Database) {
  async function save(input: StoredSession): Promise<void> {
    const { session, finalBoard } = input
    const now = new Date().toISOString()
    const statements: BatchItem<'sqlite'>[] = [db.insert(sessions).values({
      id: session.id,
      specVersion: session.specVersion,
      title: session.title,
      status: session.status,
      startedAt: session.startedAt,
      boardId: session.boardId ?? null,
      moderatorId: session.moderatorId,
      completedAt: session.completedAt ?? null,
      finalOutput: session.finalOutput ?? null,
      boardJson: JSON.stringify(finalBoard),
      updatedAt: now,
    }).onConflictDoUpdate({
      target: sessions.id,
      set: {
        title: session.title,
        status: session.status,
        boardId: session.boardId ?? null,
        moderatorId: session.moderatorId,
        completedAt: session.completedAt ?? null,
        finalOutput: session.finalOutput ?? null,
        boardJson: JSON.stringify(finalBoard),
        updatedAt: now,
      },
    }) as BatchItem<'sqlite'>]

    statements.push(...session.participants.map((participant, index) => {
      const values = {
        sessionId: session.id,
        id: participant.id,
        sequence: index + 1,
        name: participant.name,
        role: participant.role,
        specialty: participant.specialty ?? null,
        status: participant.status ?? 'active',
        joinedAt: participant.joinedAt ?? null,
        lastSeenAt: participant.lastSeenAt ?? null,
        leaseExpiresAt: participant.leaseExpiresAt ?? null,
        watchingElementIdsJson: participant.watchingElementIds ? JSON.stringify(participant.watchingElementIds) : null,
        color: participant.color ?? null,
        focusJson: participant.focus ? JSON.stringify(participant.focus) : null,
      }
      return db.insert(participants).values(values).onConflictDoUpdate({ target: [participants.sessionId, participants.id], set: values }) as BatchItem<'sqlite'>
    }))
    statements.push(db.delete(events).where(eq(events.sessionId, session.id)) as BatchItem<'sqlite'>)
    if (session.events.length) {
      statements.push(db.insert(events).values(session.events.map((event, index) => ({
        id: event.id,
        sessionId: session.id,
        sequence: index + 1,
        createdAt: event.createdAt,
        participantId: event.participantId,
        participantName: event.participantName,
        participantRole: event.participantRole,
        kind: event.kind,
        content: event.content,
        replyTo: event.replyTo ?? null,
        relatedElementIdsJson: event.relatedElementIds ? JSON.stringify(event.relatedElementIds) : null,
        metadataJson: event.metadata ? JSON.stringify(event.metadata) : null,
        checkpointJson: event.checkpoint ? JSON.stringify(event.checkpoint) : null,
      }))).onConflictDoNothing({ target: events.id }) as BatchItem<'sqlite'>)
    }
    await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  }

  async function get(id: string): Promise<StoredSession | null> {
    const stored = await db.select().from(sessions).where(eq(sessions.id, id)).get()
    if (!stored || !stored.moderatorId) return null
    const storedParticipants = await db.select().from(participants).where(eq(participants.sessionId, id)).orderBy(asc(participants.sequence)).all()
    if (!storedParticipants.some((participant) => participant.id === stored.moderatorId)) return null
    const storedEvents = await db.select().from(events).where(eq(events.sessionId, id)).orderBy(asc(events.sequence)).all()
    return {
      session: {
        specVersion: '1.0',
        id: stored.id,
        title: stored.title,
        status: stored.status as RecordingSession['status'],
        startedAt: stored.startedAt,
        boardId: stored.boardId ?? undefined,
        moderatorId: stored.moderatorId,
        completedAt: stored.completedAt ?? undefined,
        finalOutput: stored.finalOutput ?? undefined,
        participants: storedParticipants.map((participant): RecordingParticipant => ({
          id: participant.id,
          name: participant.name,
          role: participant.role as RecordingParticipant['role'],
          specialty: participant.specialty ?? undefined,
          status: participant.status as RecordingParticipant['status'],
          joinedAt: participant.joinedAt ?? undefined,
          lastSeenAt: participant.lastSeenAt ?? undefined,
          leaseExpiresAt: participant.leaseExpiresAt ?? undefined,
          watchingElementIds: participant.watchingElementIdsJson ? JSON.parse(participant.watchingElementIdsJson) as string[] : undefined,
          color: participant.color as RecordingParticipant['color'] ?? undefined,
          focus: participant.focusJson ? JSON.parse(participant.focusJson) as RecordingParticipant['focus'] : undefined,
        })),
        events: storedEvents.map((event) => ({
          id: event.id,
          createdAt: event.createdAt,
          participantId: event.participantId,
          participantName: event.participantName,
          participantRole: event.participantRole as RecordingParticipant['role'],
          kind: event.kind as ContributionKind,
          content: event.content,
          replyTo: event.replyTo ?? undefined,
          relatedElementIds: event.relatedElementIdsJson ? JSON.parse(event.relatedElementIdsJson) as string[] : undefined,
          metadata: event.metadataJson ? JSON.parse(event.metadataJson) as Record<string, string | number | boolean | null> : undefined,
          checkpoint: event.checkpointJson ? JSON.parse(event.checkpointJson) as RecordingSession['events'][number]['checkpoint'] : undefined,
        })),
      },
      finalBoard: JSON.parse(stored.boardJson) as BoardSnapshot,
    }
  }

  async function getByBoardId(boardId: string): Promise<StoredSession | null> {
    const stored = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.boardId, boardId)).orderBy(desc(sessions.updatedAt)).limit(1).get()
    return stored ? get(stored.id) : null
  }

  async function list() {
    return db.select({ id: sessions.id, title: sessions.title, status: sessions.status, startedAt: sessions.startedAt, completedAt: sessions.completedAt, updatedAt: sessions.updatedAt })
      .from(sessions).orderBy(desc(sessions.updatedAt)).limit(30).all()
  }

  async function remove(id: string): Promise<boolean> {
    const result = await db.delete(sessions).where(eq(sessions.id, id)).run()
    return result.meta.changes > 0
  }

  return { save, get, getByBoardId, list, delete: remove }
}
