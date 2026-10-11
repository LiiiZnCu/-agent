import { useEffect, useState, type CSSProperties } from 'react'
import {
  ArrowRight,
  ArrowLeft,
  BracketsCurly,
  ChatsCircle,
  Check,
  Camera,
  ClockCounterClockwise,
  DownloadSimple,
  Record,
  Robot,
  ShieldCheck,
  PencilSimple,
  Stop,
  Table,
  Trash,
  User,
  UsersThree,
  Wrench,
  X,
} from '@phosphor-icons/react'
import { TOOL_CATALOG } from '../lib/webmcp'
import { AGENT_COLOR_HEX } from '../lib/recording'
import type { Activity, AgentColor, BoardNode, RecordingEvent, RecordingSession } from '../types'

export type AgentPanelView = 'stream' | 'activity' | 'session' | 'agent'

type Props = {
  isOpen: boolean
  view: AgentPanelView
  supported: boolean
  toolCount: number
  activities: Activity[]
  nodes: BoardNode[]
  recording: RecordingSession | null
  backendState: 'checking' | 'offline' | 'syncing' | 'synced'
  onViewChange: (view: AgentPanelView) => void
  onClose: () => void
  onStartRecording: () => void
  onFinalizeRecording: () => void
  onExportRecording: (format: 'json' | 'markdown' | 'csv') => void
  exportBlockedReason?: string
  onFocusElement: (id: string) => void
  replayCheckpointId: string | null
  onAddCheckpoint: () => void
  onUpdateCheckpoint: (eventId: string, label: string) => void
  onDeleteCheckpoint: (eventId: string) => void
  onReplayCheckpoint: (eventId: string | null) => void
}

function formatElapsed(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function eventTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function ElementReference({ node, onFocus }: { node: BoardNode; onFocus: () => void }) {
  const artifact = node.data.artifact
  if (artifact) {
    return (
      <button type="button" className="mini-reference mini-artifact-reference" onClick={onFocus}>
        <span><Table size={12} weight="bold" />{artifact.artifactType}</span>
        <strong>{artifact.title}</strong>
        <div>{artifact.fields.slice(0, 3).map((field) => <code key={field.key}>{field.label}</code>)}<small>{artifact.records.length} rows</small></div>
      </button>
    )
  }
  return (
    <button type="button" className={`mini-reference mini-node-reference color-${node.data.color}`} onClick={onFocus}>
      <span>{node.data.kind}</span><strong>{node.data.title}</strong>{node.data.body && <small>{node.data.body}</small>}
    </button>
  )
}

function StreamEvent({ event, events, nodes, color, onFocusElement }: { event: RecordingEvent; events: RecordingEvent[]; nodes: BoardNode[]; color?: AgentColor; onFocusElement: (id: string) => void }) {
  const references = (event.relatedElementIds ?? []).map((id) => nodes.find((node) => node.id === id)).filter((node): node is BoardNode => Boolean(node))
  const reply = event.replyTo ? events.find((candidate) => candidate.id === event.replyTo) : null
  return (
    <article className={`stream-event role-${event.participantRole}`} style={color ? { '--agent-color': AGENT_COLOR_HEX[color] } as CSSProperties : undefined}>
      <div className="stream-avatar">{event.participantRole === 'agent' ? event.participantName.slice(0, 2).toUpperCase() : <User size={13} weight="bold" />}</div>
      <div className="stream-event-body">
        <header><strong>{event.participantName}</strong><span>{event.kind.replace('_', ' ')}</span><time>{eventTime(event.createdAt)}</time></header>
        {reply && <div className="reply-context">Replying to {reply.participantName}: {reply.content.slice(0, 72)}</div>}
        <p>{event.content}</p>
        {references.length > 0 && <div className="stream-references">{references.map((node) => <ElementReference key={node.id} node={node} onFocus={() => onFocusElement(node.id)} />)}</div>}
      </div>
    </article>
  )
}

export function AgentPanel({
  isOpen, view, supported, toolCount, activities, nodes, recording, backendState,
  onViewChange, onClose, onStartRecording, onFinalizeRecording,
  onExportRecording, exportBlockedReason, onFocusElement,
  replayCheckpointId, onAddCheckpoint, onUpdateCheckpoint, onDeleteCheckpoint, onReplayCheckpoint,
}: Props) {
  const [now, setNow] = useState(0)
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null)
  const [editingCheckpointId, setEditingCheckpointId] = useState<string | null>(null)
  const [checkpointDraft, setCheckpointDraft] = useState('')

  useEffect(() => {
    if (recording?.status !== 'recording') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [recording?.status])

  useEffect(() => {
    if (!selectedParticipantId) return
    const close = (event: PointerEvent) => {
      const target = event.target as Element
      if (!target.closest('.participant-chip, .agent-participant-popover')) setSelectedParticipantId(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedParticipantId(null)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [selectedParticipantId])

  if (!isOpen) return null
  const events = recording ? [...recording.events].reverse() : []
  const conversationEvents = events.filter((event) => !['board_action', 'result'].includes(event.kind))
  const actionEvents = events.filter((event) => ['board_action', 'result'].includes(event.kind))
  const localActivities = activities.filter((activity) => !actionEvents.some((event) => {
    if (activity.source !== 'agent' || event.participantRole !== 'agent' || event.kind !== 'board_action') return false
    const sameElement = (activity.relatedElementIds ?? []).some((id) => event.relatedElementIds?.includes(id))
    return sameElement && Math.abs(new Date(activity.createdAt).getTime() - new Date(event.createdAt).getTime()) < 5000
  }))
  const combinedActivities = [
    ...localActivities,
    ...actionEvents.map((event): Activity => ({
      id: event.id,
      label: event.kind === 'result' ? event.participantName : 'Recorded action',
      detail: event.content,
      source: event.participantRole === 'agent' ? 'agent' : event.participantRole === 'human' ? 'human' : 'system',
      actorName: event.participantName,
      createdAt: event.createdAt,
      relatedElementIds: event.relatedElementIds,
    })),
  ].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 60)
  const selectedParticipant = recording?.participants.find((participant) => participant.id === selectedParticipantId) ?? null
  const checkpoints = recording?.events.filter((event) => event.kind === 'checkpoint' && event.checkpoint) ?? []
  const replayIndex = checkpoints.findIndex((event) => event.id === replayCheckpointId)
  const selectedParticipantStatus = selectedParticipant?.status !== 'muted' && selectedParticipant?.leaseExpiresAt && new Date(selectedParticipant.leaseExpiresAt).getTime() < now
    ? 'offline'
    : selectedParticipant?.status ?? 'active'

  return (
    <aside className="agent-panel" aria-label="Collaboration sidebar">
      <div className="panel-heading agent-heading">
        <div className="agent-mark"><Robot size={20} weight="fill" /></div>
        <div><span className="panel-kicker">Canvas Relay</span><h2>Collaboration</h2></div>
        <button type="button" className="icon-button panel-close" onClick={onClose} aria-label="Close collaboration sidebar"><X size={18} /></button>
      </div>

      <nav className="panel-tabs" aria-label="Collaboration views">
        <button type="button" className={view === 'stream' ? 'is-active' : ''} onClick={() => onViewChange('stream')}><ChatsCircle size={15} />Conversation</button>
        <button type="button" className={view === 'activity' ? 'is-active' : ''} onClick={() => onViewChange('activity')}><ClockCounterClockwise size={15} />Activity</button>
        <button type="button" className={view === 'session' ? 'is-active' : ''} onClick={() => onViewChange('session')}><Record size={14} weight="fill" />Trace</button>
        <button type="button" className={view === 'agent' ? 'is-active' : ''} onClick={() => onViewChange('agent')}><Wrench size={15} />Agent</button>
      </nav>

      {view === 'stream' && (
        <section className="stream-section" aria-live="polite">
          <div className="stream-heading"><div><span className="panel-kicker">Shared conversation</span><h3>{recording?.title ?? 'This mural'}</h3></div><span>{conversationEvents.length}</span></div>
          {conversationEvents.length ? (
            <div className="stream-list">{conversationEvents.slice(0, 30).map((event) => <StreamEvent key={event.id} event={event} events={recording?.events ?? []} nodes={nodes} color={recording?.participants.find((participant) => participant.id === event.participantId)?.color} onFocusElement={onFocusElement} />)}</div>
          ) : <div className="stream-empty"><ChatsCircle size={24} /><strong>No messages yet</strong><p>Use the field on the canvas or connect agents to begin a visible brainstorm.</p></div>}
        </section>
      )}

      {view === 'activity' && (
        <section className="stream-section" aria-live="polite">
          <div className="stream-heading"><div><span className="panel-kicker">Action history</span><h3>Canvas changes and outputs</h3></div><span>{combinedActivities.length}</span></div>
          {combinedActivities.length ? (
            <div className="activity-list visual-activity-list">{combinedActivities.map((activity) => (
              <article className="activity-item" key={activity.id}>
                <span className={`activity-source source-${activity.source}`}>{activity.actorName ?? (activity.source === 'human' ? '未指定成员' : activity.source === 'system' ? 'System' : 'Agent')}</span>
                <div><strong>{activity.label}</strong><small>{activity.detail}</small></div>
                {(activity.relatedElementIds ?? []).map((id) => {
                  const node = nodes.find((candidate) => candidate.id === id)
                  return node ? <ElementReference key={id} node={node} onFocus={() => onFocusElement(id)} /> : null
                })}
              </article>
            ))}</div>
          ) : <div className="stream-empty"><ClockCounterClockwise size={24} /><strong>No actions yet</strong><p>Canvas changes and reusable artifact previews will appear in this dedicated history.</p></div>}
        </section>
      )}

      {view === 'session' && (
        <section className="recorder-section standalone-recorder">
          <div className="recorder-header">
            <div><span className="panel-kicker">Decision trace</span><h3>{recording ? recording.title : 'Record the whole session'}</h3></div>
            {recording?.status === 'recording' && <span className="rec-badge"><Record size={10} weight="fill" />REC {formatElapsed(recording.startedAt, now)}</span>}
          </div>
          <div className={`storage-status state-${backendState}`}><span />{backendState === 'synced' ? 'Synced to local SQLite' : backendState === 'syncing' ? 'Syncing SQLite' : backendState === 'checking' ? 'Checking local backend' : 'Offline cache active'}</div>
          {!recording ? <><p>Preserve shared messages, agent work, decisions, and the final mural.</p><div className="recorder-actions"><button type="button" className="record-button" onClick={onStartRecording}><Record size={15} weight="fill" />Record session</button></div></> : (
            <>
              <div className="session-access"><span>Mural UUID</span><code>{recording.boardId ?? 'Local session'}</code></div>
              <section className="checkpoint-timeline" aria-label="Replay checkpoints">
                <div className="checkpoint-heading"><div><Camera size={15} /><strong>Replay checkpoints</strong></div><button type="button" onClick={onAddCheckpoint}>Save current</button></div>
                {checkpoints.length ? (
                  <>
                    <div className="checkpoint-player">
                      <button type="button" disabled={replayIndex <= 0} onClick={() => onReplayCheckpoint(checkpoints[Math.max(0, replayIndex - 1)]?.id ?? checkpoints[0].id)} aria-label="Previous checkpoint"><ArrowLeft size={15} /></button>
                      <div><span>{replayIndex >= 0 ? `${replayIndex + 1} / ${checkpoints.length}` : `${checkpoints.length} saved`}</span><strong>{replayIndex >= 0 ? checkpoints[replayIndex].checkpoint!.label : 'Live mural'}</strong></div>
                      <button type="button" disabled={replayIndex === checkpoints.length - 1} onClick={() => onReplayCheckpoint(checkpoints[replayIndex < 0 ? 0 : replayIndex + 1]?.id ?? null)} aria-label="Next checkpoint"><ArrowRight size={15} /></button>
                    </div>
                    {replayCheckpointId && <button type="button" className="return-live-button" onClick={() => onReplayCheckpoint(null)}>Return to live mural</button>}
                    <div className="checkpoint-list">{checkpoints.map((event, index) => (
                      <div className={event.id === replayCheckpointId ? 'is-active' : ''} key={event.id}>
                        <button type="button" className="checkpoint-open" onClick={() => onReplayCheckpoint(event.id)}><span>{index + 1}</span><strong>{event.checkpoint!.label}</strong><small>{event.checkpoint!.board.nodes.length} elements</small></button>
                        {editingCheckpointId === event.id ? (
                          <input
                            autoFocus
                            value={checkpointDraft}
                            maxLength={120}
                            aria-label="Checkpoint label"
                            onChange={(input) => setCheckpointDraft(input.target.value)}
                            onBlur={() => { if (checkpointDraft.trim()) onUpdateCheckpoint(event.id, checkpointDraft); setEditingCheckpointId(null) }}
                            onKeyDown={(input) => {
                              if (input.key === 'Enter') input.currentTarget.blur()
                              if (input.key === 'Escape') setEditingCheckpointId(null)
                            }}
                          />
                        ) : <button type="button" className="checkpoint-icon" onClick={() => { setEditingCheckpointId(event.id); setCheckpointDraft(event.checkpoint!.label) }} aria-label={`Rename ${event.checkpoint!.label}`}><PencilSimple size={13} /></button>}
                        <button type="button" className="checkpoint-icon is-danger" onClick={() => onDeleteCheckpoint(event.id)} aria-label={`Delete ${event.checkpoint!.label}`}><Trash size={13} /></button>
                      </div>
                    ))}</div>
                  </>
                ) : <p>No checkpoints yet. Save milestones to replay how the mural evolved.</p>}
              </section>
              <div className="participant-heading"><UsersThree size={15} /><strong>{recording.participants.length} participants</strong><span>visible to everyone</span></div>
              <div className="participant-list">{recording.participants.map((participant) => {
                const status = participant.status !== 'muted' && participant.leaseExpiresAt && new Date(participant.leaseExpiresAt).getTime() < now ? 'offline' : participant.status ?? 'active'
                return (
                <button type="button" className={`participant-chip state-${status}`} style={participant.color ? { '--agent-color': AGENT_COLOR_HEX[participant.color] } as CSSProperties : undefined} key={participant.id} title={participant.specialty} onClick={() => setSelectedParticipantId((current) => current === participant.id ? null : participant.id)} aria-expanded={selectedParticipantId === participant.id}>
                  <span className={`participant-avatar role-${participant.role}`}>{participant.role === 'agent' ? <Robot size={12} weight="fill" /> : <User size={12} weight="bold" />}</span>
                  <span>
                    <strong>{participant.name}{participant.id === recording.moderatorId && <span className="moderator-mark"><ShieldCheck size={10} weight="fill" />Moderator</span>}</strong>
                    <small>{status === 'muted' ? 'Muted, observing only' : status === 'offline' ? 'Offline, lease expired' : participant.focus ? `${participant.focus.state === 'editing' ? 'Editing' : 'Reviewing'} ${participant.focus.elementIds.length} components` : participant.watchingElementIds?.length ? `Watching ${participant.watchingElementIds.length} components` : participant.role === 'human' ? '讨论成员' : participant.specialty || 'Agent'}</small>
                  </span>
                </button>
              )})}</div>
              {selectedParticipant && (
                <div className="agent-participant-popover" role="dialog" aria-label={`${selectedParticipant.name} participant details`}>
                  <button type="button" className="icon-button" onClick={() => setSelectedParticipantId(null)} aria-label="Close participant details"><X size={14} /></button>
                  <span className={`participant-avatar role-${selectedParticipant.role}`} style={selectedParticipant.color ? { '--agent-color': AGENT_COLOR_HEX[selectedParticipant.color] } as CSSProperties : undefined}>{selectedParticipant.role === 'agent' ? <Robot size={13} weight="fill" /> : <User size={13} weight="bold" />}</span>
                  <div><span className="panel-kicker">{selectedParticipant.role} · {selectedParticipantStatus}</span><strong>{selectedParticipant.name}</strong><p>{selectedParticipant.specialty || (selectedParticipant.role === 'human' ? 'Human facilitator' : 'Agent participant')}</p></div>
                  <dl>
                    <div><dt>Participant ID</dt><dd>{selectedParticipant.id}</dd></div>
                    <div><dt>Watching</dt><dd>{selectedParticipant.watchingElementIds?.length ? `${selectedParticipant.watchingElementIds.length} components` : 'Global mural stream'}</dd></div>
                    <div><dt>Presence</dt><dd>{selectedParticipant.leaseExpiresAt ? `Lease until ${eventTime(selectedParticipant.leaseExpiresAt)}` : 'Session participant'}</dd></div>
                    <div><dt>Focus</dt><dd>{selectedParticipant.focus ? `${selectedParticipant.focus.state}: ${selectedParticipant.focus.intent || 'Active work'}` : 'No active focus'}</dd></div>
                  </dl>
                </div>
              )}
              <div className="recorder-stats"><span><strong>{recording.events.length}</strong> events</span><span><strong>{recording.participants.filter((person) => person.role === 'agent').length}</strong> agents</span></div>
              <div className="recorder-actions">{recording.status === 'recording' ? <button type="button" className="stop-button" onClick={onFinalizeRecording}><Stop size={14} weight="fill" />Finish session</button> : <><button type="button" className="secondary-button" disabled={Boolean(exportBlockedReason)} onClick={() => onExportRecording('json')}><DownloadSimple size={15} />JSON</button><button type="button" className="secondary-button" disabled={Boolean(exportBlockedReason)} onClick={() => onExportRecording('markdown')}><DownloadSimple size={15} />MD</button><button type="button" className="secondary-button" disabled={Boolean(exportBlockedReason)} onClick={() => onExportRecording('csv')}><DownloadSimple size={15} />CSV</button></>}</div>
              {recording.status === 'complete' && exportBlockedReason && <p role="note">{exportBlockedReason}</p>}
              {recording.status === 'complete' && <button type="button" className="text-button new-trace-button" onClick={onStartRecording}>Start another trace</button>}
              <p className="privacy-note">Shared summaries only. Private model reasoning is never recorded.</p>
            </>
          )}
        </section>
      )}

      {view === 'agent' && (
        <>
          <div className={`webmcp-status ${supported ? 'is-ready' : 'is-offline'}`}><div>{supported ? <Check size={16} weight="bold" /> : <BracketsCurly size={16} weight="bold" />}<strong>{supported ? `WebMCP ready, ${toolCount} tools` : 'WebMCP browser needed'}</strong></div><p>{supported ? 'Agents can read and change this mural directly.' : 'Use ChatGPT or Chromium 149+ with WebMCP enabled.'}</p></div>
          <section className="agent-section tool-catalog-section"><div className="agent-section-title"><BracketsCurly size={16} /><h3>Tool surface</h3><span>{TOOL_CATALOG.length}</span></div><div className="tool-catalog">{TOOL_CATALOG.map((tool) => <div key={tool.name}><code>{tool.name.replace('canvas_', '')}</code><span className={`tool-mode mode-${tool.mode}`}>{tool.mode}</span></div>)}</div></section>
        </>
      )}
    </aside>
  )
}
