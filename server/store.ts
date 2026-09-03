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
      completedAt: session.completedAt,
      finalOutput: session.finalOutput,
      boardJson: JSON.stringify(finalBoard),
      updatedAt: now,
    }).onConflictDoUpdate({
      target: sessions.id,
      set: {
        title: session.title,
        status: session.status,
        completedAt: session.completedAt,
        finalOutput: session.finalOutput,
        boardJson: JSON.stringify(finalBoard),
        updatedAt: now,
      },
    }).run()

    tx.delete(participants).where(eq(participants.sessionId, session.id)).run()
    tx.delete(events).where(eq(events.sessionId, session.id)).run()

    if (session.participants.length) {
      tx.insert(participants).values(session.participants.map((participant, index) => ({
        sessionId: session.id,
        id: participant.id,
        sequence: index + 1,
        name: participant.name,
        role: participant.role,
        specialty: participant.specialty,
      }))).run()
    }

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
      }))).run()
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
      completedAt: stored.completedAt ?? undefined,
      finalOutput: stored.finalOutput ?? undefined,
      participants: storedParticipants.map((participant): RecordingParticipant => ({
        id: participant.id,
        name: participant.name,
        role: participant.role as RecordingParticipant['role'],
        specialty: participant.specialty ?? undefined,
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
      })),
    },
    finalBoard: JSON.parse(stored.boardJson) as BoardSnapshot,
  }
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
