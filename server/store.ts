import { asc, desc, eq } from 'drizzle-orm'
import type { BoardSnapshot, ContributionKind, RecordingParticipant, RecordingSession } from '../src/types.ts'
import { db } from './db.ts'
import { events, participants, sessions } from './schema.ts'

export type StoredSession = {
  session: RecordingSession
  finalBoard: BoardSnapshot
}

export function saveSession(input: StoredSession) {
  const { session, finalBoard } = input
  const now = new Date().toISOString()
  db.transaction((tx) => {
    tx.insert(sessions).values({
      id: session.id,
      specVersion: session.specVersion,
      title: session.title,
      status: session.status,
      startedAt: session.startedAt,
      boardId: session.boardId,
      moderatorId: session.moderatorId,
      completedAt: session.completedAt,
      finalOutput: session.finalOutput,
      boardJson: JSON.stringify(finalBoard),
      updatedAt: now,
    }).onConflictDoUpdate({
      target: sessions.id,
      set: {
        title: session.title,
        status: session.status,
        boardId: session.boardId,
        moderatorId: session.moderatorId,
        completedAt: session.completedAt,
        finalOutput: session.finalOutput,
        boardJson: JSON.stringify(finalBoard),
        updatedAt: now,
      },
    }).run()

    if (session.participants.length) {
      session.participants.forEach((participant, index) => {
        const values = {
          sessionId: session.id,
          id: participant.id,
          sequence: index + 1,
          name: participant.name,
          role: participant.role,
          specialty: participant.specialty,
          status: participant.status ?? 'active',
          joinedAt: participant.joinedAt,
          lastSeenAt: participant.lastSeenAt,
          leaseExpiresAt: participant.leaseExpiresAt,
          watchingElementIdsJson: participant.watchingElementIds ? JSON.stringify(participant.watchingElementIds) : null,
          color: participant.color,
          focusJson: participant.focus ? JSON.stringify(participant.focus) : null,
        }
        tx.insert(participants).values(values).onConflictDoUpdate({
          target: [participants.sessionId, participants.id],
          set: values,
        }).run()
      })
    }

    tx.delete(events).where(eq(events.sessionId, session.id)).run()
    if (session.events.length) {
      tx.insert(events).values(session.events.map((event, index) => ({
        id: event.id,
        sessionId: session.id,
        sequence: index + 1,
        createdAt: event.createdAt,
        participantId: event.participantId,
        participantName: event.participantName,
        participantRole: event.participantRole,
        kind: event.kind,
        content: event.content,
        replyTo: event.replyTo,
        relatedElementIdsJson: event.relatedElementIds ? JSON.stringify(event.relatedElementIds) : null,
        metadataJson: event.metadata ? JSON.stringify(event.metadata) : null,
        checkpointJson: event.checkpoint ? JSON.stringify(event.checkpoint) : null,
      }))).onConflictDoNothing({ target: events.id }).run()
    }
  })
}

export function getSession(id: string): StoredSession | null {
  const stored = db.select().from(sessions).where(eq(sessions.id, id)).get()
  if (!stored) return null
  const storedParticipants = db.select().from(participants).where(eq(participants.sessionId, id)).orderBy(asc(participants.sequence)).all()
  const storedEvents = db.select().from(events).where(eq(events.sessionId, id)).orderBy(asc(events.sequence)).all()

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

export function getSessionByBoardId(boardId: string): StoredSession | null {
  const stored = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.boardId, boardId)).orderBy(desc(sessions.updatedAt)).limit(1).get()
  return stored ? getSession(stored.id) : null
}

export function listSessions() {
  return db.select({
    id: sessions.id,
    title: sessions.title,
    status: sessions.status,
    startedAt: sessions.startedAt,
    completedAt: sessions.completedAt,
    updatedAt: sessions.updatedAt,
  }).from(sessions).orderBy(desc(sessions.updatedAt)).limit(30).all()
}

export function deleteSession(id: string) {
  return db.delete(sessions).where(eq(sessions.id, id)).run().changes > 0
}
