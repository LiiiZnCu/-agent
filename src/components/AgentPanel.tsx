import { useEffect, useState } from 'react'
import { ArrowRight, BracketsCurly, ChatText, Check, DownloadSimple, Record, Robot, Sparkle, Stop, User, UsersThree, X } from '@phosphor-icons/react'
import { TOOL_CATALOG } from '../lib/webmcp'
import type { Activity, RecordingSession } from '../types'

type Props = {
  isOpen: boolean
  supported: boolean
  toolCount: number
  activities: Activity[]
  recording: RecordingSession | null
  backendState: 'checking' | 'offline' | 'syncing' | 'synced'
  onClose: () => void
  onRunDemo: (recipe: 'diverge' | 'cluster' | 'artifact') => void
  onStartRecording: () => void
  onFinalizeRecording: () => void
  onExportRecording: (format: 'json' | 'markdown' | 'csv') => void
  onRecordUserMessage: (content: string) => void
  onLoadMultiAgentDemo: () => void
}

const RECIPES = [
  { id: 'diverge' as const, label: 'Generate six ideas', detail: 'Create a diverse set around the current brief.' },
  { id: 'cluster' as const, label: 'Group by theme', detail: 'Frame related ideas and arrange the canvas.' },
  { id: 'artifact' as const, label: 'Build a decision table', detail: 'Compare the strongest ideas as structured data.' },
]

function formatElapsed(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function AgentPanel({
  isOpen,
  supported,
  toolCount,
  activities,
  recording,
  backendState,
  onClose,
  onRunDemo,
  onStartRecording,
  onFinalizeRecording,
  onExportRecording,
  onRecordUserMessage,
  onLoadMultiAgentDemo,
}: Props) {
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(0)

  useEffect(() => {
    if (recording?.status !== 'recording') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [recording?.status])

  if (!isOpen) return null

  return (
    <aside className="agent-panel" aria-label="Agent activity">
      <div className="panel-heading agent-heading">
        <div className="agent-mark"><Robot size={20} weight="fill" /></div>
        <div>
          <span className="panel-kicker">Agent workspace</span>
          <h2>WebMCP controls</h2>
        </div>
        <button type="button" className="icon-button panel-close" onClick={onClose} aria-label="Close agent panel"><X size={18} /></button>
      </div>

      <div className={`webmcp-status ${supported ? 'is-ready' : 'is-offline'}`}>
        <div>
          {supported ? <Check size={16} weight="bold" /> : <BracketsCurly size={16} weight="bold" />}
          <strong>{supported ? `WebMCP ready, ${toolCount} tools` : 'WebMCP browser needed'}</strong>
        </div>
        <p>{supported ? 'Your agent can read and change this board directly.' : 'Open in ChatGPT or Chrome 149+ with WebMCP enabled.'}</p>
      </div>

      <section className="recorder-section">
        <div className="recorder-header">
          <div>
            <span className="panel-kicker">Decision trace</span>
            <h3>{recording ? recording.title : 'Record the whole session'}</h3>
          </div>
          {recording?.status === 'recording' ? (
            <span className="rec-badge"><Record size={10} weight="fill" />REC {formatElapsed(recording.startedAt, now)}</span>
          ) : null}
        </div>
        <div className={`storage-status state-${backendState}`}>
          <span />
          {backendState === 'synced' ? 'Synced to local SQLite' : backendState === 'syncing' ? 'Syncing SQLite' : backendState === 'checking' ? 'Checking local backend' : 'Offline cache active'}
        </div>
        {!recording ? (
          <>
            <p>Save visible discussion, agent contributions, canvas actions, decisions, and the final board on this device.</p>
            <div className="recorder-actions">
              <button type="button" className="record-button" onClick={onStartRecording}><Record size={15} weight="fill" />Record session</button>
              <button type="button" className="text-button" onClick={onLoadMultiAgentDemo}>Load 3-agent demo</button>
            </div>
          </>
        ) : (
          <>
            <div className="participant-heading"><UsersThree size={15} /><strong>{recording.participants.length} participants</strong><span>visible to everyone</span></div>
            <div className="participant-list">
              {recording.participants.map((participant) => (
                <div className="participant-chip" key={participant.id} title={participant.specialty}>
                  <span className={`participant-avatar role-${participant.role}`}>
                    {participant.role === 'agent' ? <Robot size={12} weight="fill" /> : <User size={12} weight="bold" />}
                  </span>
                  <span><strong>{participant.name}</strong><small>{participant.role === 'human' ? 'You, facilitator' : participant.specialty || 'Agent'}</small></span>
                </div>
              ))}
            </div>
            {recording.status === 'recording' && (
              <form className="user-message-form" onSubmit={(event) => {
                event.preventDefault()
                if (!message.trim()) return
                onRecordUserMessage(message)
                setMessage('')
              }}>
                <label htmlFor="user-contribution"><ChatText size={14} />Add your contribution</label>
                <textarea id="user-contribution" rows={2} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Share a prompt, constraint, question, or decision" />
                <div>
                  <span>Recorded as Human</span>
                  <button type="submit" disabled={!message.trim()}>Add to trace</button>
                </div>
              </form>
            )}
            <div className="recorder-stats">
              <span><strong>{recording.events.length}</strong> events</span>
              <span><strong>{recording.participants.filter((person) => person.role === 'agent').length}</strong> agents</span>
            </div>
            <div className="trace-preview" aria-live="polite">
              <div className="trace-preview-heading"><strong>Shared thought stream</strong><span>Latest first</span></div>
              {[...recording.events].reverse().slice(0, 6).map((event) => (
                <div className="trace-event" key={event.id}>
                  <span className={`trace-kind kind-${event.kind}`}>{event.kind.replace('_', ' ')}</span>
                  <div>
                    <strong>{event.participantName}</strong>
                    <p>{event.content}</p>
                    {event.replyTo && <small>Reply to {event.replyTo.slice(-8)}</small>}
                  </div>
                </div>
              ))}
            </div>
            <div className="recorder-actions">
              {recording.status === 'recording' ? (
                <button type="button" className="stop-button" onClick={onFinalizeRecording}><Stop size={14} weight="fill" />Finish session</button>
              ) : (
                <>
                  <button type="button" className="secondary-button" onClick={() => onExportRecording('json')}><DownloadSimple size={15} />JSON</button>
                  <button type="button" className="secondary-button" onClick={() => onExportRecording('markdown')}><DownloadSimple size={15} />Markdown</button>
                  <button type="button" className="secondary-button" onClick={() => onExportRecording('csv')}><DownloadSimple size={15} />CSV</button>
                  <button type="button" className="text-button new-trace-button" onClick={onStartRecording}>New recording</button>
                </>
              )}
            </div>
            <p className="privacy-note">Stored only on this device. The trace contains shared summaries, never private model reasoning.</p>
          </>
        )}
      </section>

      <section className="agent-section">
        <div className="agent-section-title"><Sparkle size={16} weight="fill" /><h3>Try the shared action layer</h3></div>
        <p className="section-help">These local recipes call the same board actions exposed to external agents.</p>
        <div className="recipe-list">
          {RECIPES.map((recipe) => (
            <button type="button" key={recipe.id} onClick={() => onRunDemo(recipe.id)}>
              <span><strong>{recipe.label}</strong><small>{recipe.detail}</small></span>
              <ArrowRight size={17} />
            </button>
          ))}
        </div>
      </section>

      <section className="agent-section tool-catalog-section">
        <div className="agent-section-title"><BracketsCurly size={16} /><h3>Tool surface</h3><span>{TOOL_CATALOG.length}</span></div>
        <div className="tool-catalog">
          {TOOL_CATALOG.map((tool) => (
            <div key={tool.name}>
              <code>{tool.name.replace('canvas_', '')}</code>
              <span className={`tool-mode mode-${tool.mode}`}>{tool.mode}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="agent-section activity-section" aria-live="polite">
        <div className="agent-section-title"><h3>Recent activity</h3></div>
        {activities.length ? (
          <div className="activity-list">
            {activities.slice(0, 5).map((activity) => (
              <div className="activity-item" key={activity.id}>
                <span className={`activity-source source-${activity.source}`}>{activity.source}</span>
                <div><strong>{activity.label}</strong><small>{activity.detail}</small></div>
              </div>
            ))}
          </div>
        ) : <p className="activity-empty">Agent actions will appear here as they happen.</p>}
      </section>
    </aside>
  )
}
