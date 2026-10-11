import { useEffect, useState, type CSSProperties } from 'react'
import { PaperPlaneTilt, Plus, Robot, User } from '@phosphor-icons/react'
import type { BrainstormMember, RecordingParticipant, RecordingSession } from '../types'
import { AGENT_COLOR_HEX } from '../lib/recording'

type Props = {
  recording: RecordingSession | null
  members: BrainstormMember[]
  onSend: (content: string) => void
  onOpenTrace: () => void
}

function initials(participant: RecordingParticipant) {
  return participant.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

export function CollaborationDock({ recording, members, onSend, onOpenTrace }: Props) {
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])
  const participants = recording?.participants.filter((participant) => participant.role !== 'system')
    ?? members.map((member): RecordingParticipant => ({ id: member.id, name: member.name, role: 'human' }))

  return (
    <div className="collaboration-dock" aria-label="与智能体协作">
      <div className="presence-orbit" aria-label={`${participants.length} 位成员已连接`}>
        <div className="presence-stack">
          {participants.slice(0, 6).map((participant, index) => {
            const status = participant.status !== 'muted' && participant.leaseExpiresAt && new Date(participant.leaseExpiresAt).getTime() < now ? 'offline' : participant.status ?? 'active'
            return (
            <button
              type="button"
              key={participant.id}
              className={`presence-avatar role-${participant.role} state-${status}`}
              style={{ zIndex: participants.length - index, ...(participant.color ? { '--agent-color': AGENT_COLOR_HEX[participant.color] } : {}) } as CSSProperties}
              title={`${participant.name}${participant.id === recording?.moderatorId ? '，主持人' : ''}${participant.specialty ? `：${participant.specialty}` : ''}`}
              onClick={onOpenTrace}
            >
              {participant.role === 'agent' ? initials(participant) || <Robot size={15} /> : <User size={15} weight="bold" />}
              <span className="presence-live" aria-label={status === 'muted' ? '已静音' : status === 'offline' ? '离线' : '已连接'} />
            </button>
          )})}
          {!recording && (
            <button type="button" className="presence-avatar presence-invite" onClick={onOpenTrace} title="通过 WebMCP 连接智能体">
              <Plus size={15} weight="bold" />
            </button>
          )}
        </div>
        <button type="button" className="presence-label" onClick={onOpenTrace}>
          {participants.length ? `白板中有 ${participants.length} 位成员` : '尚未添加成员'}
        </button>
      </div>

      <form className="canvas-composer" onSubmit={(event) => {
        event.preventDefault()
        const content = message.trim()
        if (!content) return
        onSend(content)
        setMessage('')
      }}>
        <label htmlFor="canvas-agent-message">给智能体发送消息</label>
        <div>
          <input
            id="canvas-agent-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="提出问题、补充约束或作出决定"
            maxLength={5000}
          />
          <button type="submit" disabled={!message.trim()} aria-label="发送消息到共享讨论">
            <PaperPlaneTilt size={17} weight="fill" />
          </button>
        </div>
        <span>{recording?.status === 'recording' ? '实时共享并加入记录' : '发送后开始新的决策记录'}</span>
      </form>
    </div>
  )
}
