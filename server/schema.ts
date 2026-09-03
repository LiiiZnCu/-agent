import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  specVersion: text('spec_version').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  boardId: text('board_id'),
  moderatorId: text('moderator_id').notNull(),
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
  status: text('status').notNull(),
  joinedAt: text('joined_at'),
  lastSeenAt: text('last_seen_at'),
  leaseExpiresAt: text('lease_expires_at'),
  watchingElementIdsJson: text('watching_element_ids_json'),
  color: text('color'),
  focusJson: text('focus_json'),
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
  checkpointJson: text('checkpoint_json'),
})

export const murals = sqliteTable('murals', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  boardJson: text('board_json').notNull(),
  ownerTokenHash: text('owner_token_hash').notNull(),
  userTokenHash: text('user_token_hash').notNull(),
  revision: integer('revision').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const muralInvites = sqliteTable('mural_invites', {
  id: text('id').primaryKey(),
  muralId: text('mural_id').notNull().references(() => murals.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  agentId: text('agent_id').notNull(),
  agentName: text('agent_name').notNull(),
  specialty: text('specialty'),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull(),
  redeemedAt: text('redeemed_at'),
})

export const muralFocusClaims = sqliteTable('mural_focus_claims', {
  muralId: text('mural_id').notNull().references(() => murals.id, { onDelete: 'cascade' }),
  elementId: text('element_id').notNull(),
  participantId: text('participant_id').notNull(),
  participantName: text('participant_name').notNull(),
  color: text('color'),
  state: text('state').notNull(),
  intent: text('intent').notNull(),
  claimedAt: text('claimed_at').notNull(),
  leaseExpiresAt: text('lease_expires_at').notNull(),
  releaseOnAction: text('release_on_action').notNull(),
}, (table) => [primaryKey({ columns: [table.muralId, table.elementId] })])
