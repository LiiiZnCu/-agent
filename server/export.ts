import type { StoredSession } from './store.ts'

function escapeCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export function toMarkdown({ session, finalBoard }: StoredSession) {
  return [
    `# ${session.title}`,
    '',
    `Status: ${session.status}`,
    `Started: ${session.startedAt}`,
    session.completedAt ? `Completed: ${session.completedAt}` : '',
    `Participants: ${session.participants.map((person) => `${person.name} (${person.role})`).join(', ')}`,
    '',
    '## Shared thought stream',
    '',
    '| Time | Participant | Type | Contribution |',
    '| --- | --- | --- | --- |',
    ...session.events.map((event) => `| ${escapeCell(event.createdAt)} | ${escapeCell(event.participantName)} | ${event.kind} | ${escapeCell(event.content)} |`),
    '',
    '## Final output',
    '',
    session.finalOutput || 'The session is still active.',
    '',
    '## Final board snapshot',
    '',
    '```json',
    JSON.stringify(finalBoard, null, 2),
    '```',
  ].filter((line, index, list) => line || list[index - 1] !== '').join('\n')
}

function csvCell(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return `"${text.replace(/"/g, '""')}"`
}

export function toCsv({ session }: StoredSession) {
  return [
    ['sequence', 'timestamp', 'participant_id', 'participant_name', 'role', 'kind', 'content', 'reply_to', 'element_ids'].map(csvCell).join(','),
    ...session.events.map((event, index) => [
      index + 1,
      event.createdAt,
      event.participantId,
      event.participantName,
      event.participantRole,
      event.kind,
      event.content,
      event.replyTo ?? '',
      event.relatedElementIds?.join(' ') ?? '',
    ].map(csvCell).join(',')),
  ].join('\n')
}
