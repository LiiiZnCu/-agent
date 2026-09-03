import { useEffect, useState, type CSSProperties } from 'react'
import { PaperPlaneTilt, Plus, Robot, User } from '@phosphor-icons/react'
import type { RecordingParticipant, RecordingSession } from '../types'
import { AGENT_COLOR_HEX } from '../lib/recording'

type Props = {
  recording: RecordingSession | null
  onSend: (content: string) => void
  onOpenTrace: () => void
}

function initials(participant: RecordingParticipant) {
  return participant.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

export function CollaborationDock({ recording, onSend, onOpenTrace }: Props) {
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])
  const participants = recording?.participants.filter((participant) => participant.role !== 'system') ?? [
    { id: 'human-facilitator', name: 'You', role: 'human' as const, specialty: 'Facilitator' },
  ]

  return (
    <div className="collaboration-dock" aria-label="Collaborate with agents">
      <div className="presence-orbit" aria-label={`${participants.length} participants connected`}>
        <div className="presence-stack">
          {participants.slice(0, 6).map((participant, index) => {
            const status = participant.status !== 'muted' && participant.leaseExpiresAt && new Date(participant.leaseExpiresAt).getTime() < now ? 'offline' : participant.status ?? 'active'
            return (
            <button
              type="button"
              key={participant.id}
              className={`presence-avatar role-${participant.role} state-${status}`}
              style={{ zIndex: participants.length - index, ...(participant.color ? { '--agent-color': AGENT_COLOR_HEX[participant.color] } : {}) } as CSSProperties}
              title={`${participant.name}${participant.id === recording?.moderatorId ? ', moderator' : ''}${participant.specialty ? `: ${participant.specialty}` : ''}`}
              onClick={onOpenTrace}
            >
              {participant.role === 'agent' ? initials(participant) || <Robot size={15} /> : <User size={15} weight="bold" />}
              <span className="presence-live" aria-label={status === 'muted' ? 'Muted' : status === 'offline' ? 'Offline' : 'Connected'} />
            </button>
          )})}
          {!recording && (
            <button type="button" className="presence-avatar presence-invite" onClick={onOpenTrace} title="Connect agents with WebMCP">
              <Plus size={15} weight="bold" />
            </button>
          )}
        </div>
        <button type="button" className="presence-label" onClick={onOpenTrace}>
          {recording ? `${participants.length} in this mural` : 'You are here'}
        </button>
      </div>

      <form className="canvas-composer" onSubmit={(event) => {
        event.preventDefault()
        const content = message.trim()
        if (!content) return
        onSend(content)
        setMessage('')
      }}>
        <label htmlFor="canvas-agent-message">Message your agents</label>
        <div>
          <input
            id="canvas-agent-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ask, add a constraint, or make a decision"
            maxLength={5000}
          />
          <button type="submit" disabled={!message.trim()} aria-label="Send message to the shared stream">
            <PaperPlaneTilt size={17} weight="fill" />
          </button>
        </div>
        <span>{recording?.status === 'recording' ? 'Shared live and added to the trace' : 'Sending starts a new decision trace'}</span>
      </form>
    </div>
  )
}
