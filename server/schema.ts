import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  specVersion: text('spec_version').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  finalOutput: text('final_output'),
  boardJson: text('board_json').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const participants = sqliteTable('participants', {
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  id: text('id').notNull(),
  sequence: integer('sequence').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  specialty: text('specialty'),
}, (table) => [primaryKey({ columns: [table.sessionId, table.id] })])

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  createdAt: text('created_at').notNull(),
  participantId: text('participant_id').notNull(),
  participantName: text('participant_name').notNull(),
  participantRole: text('participant_role').notNull(),
  kind: text('kind').notNull(),
  content: text('content').notNull(),
  replyTo: text('reply_to'),
  relatedElementIdsJson: text('related_element_ids_json'),
  metadataJson: text('metadata_json'),
})
