import { useState } from 'react'
import { BRAINSTORM_STAGES, setBrainstormStage } from '../lib/brainstorm'
import type { BrainstormSession } from '../types'

export function StageNavigator({ session, onChange }: { session: BrainstormSession; onChange: (session: BrainstormSession) => void }) {
  const [editing, setEditing] = useState(false)
  const [topic, setTopic] = useState(session.topic)
  const [notice, setNotice] = useState('')
  const index = BRAINSTORM_STAGES.findIndex((stage) => stage.id === session.stage)
  const navigate = (next: number) => {
    onChange(setBrainstormStage(session, BRAINSTORM_STAGES[next].id, new Date().toISOString()))
    setNotice('')
  }
  return <nav className="discussion-stage-nav" aria-label="讨论阶段">
    <strong>{session.topic}</strong><span>{session.members.find((member) => member.id === session.currentMemberId)?.name}</span>
    <button type="button" onClick={() => { setTopic(session.topic); setEditing(true) }}>编辑讨论主题</button>
    {editing && <form onSubmit={(event) => {
      event.preventDefault()
      if (!topic.trim()) return
      onChange({ ...session, topic: topic.trim(), updatedAt: new Date().toISOString() })
      setEditing(false)
    }}><label>讨论主题<input required value={topic} onChange={(event) => setTopic(event.target.value)} /></label><button disabled={!topic.trim()}>保存主题</button><button type="button" onClick={() => setEditing(false)}>取消</button></form>}
    <div className="stage-buttons">{BRAINSTORM_STAGES.map((stage, next) => <button key={stage.id} type="button" aria-current={session.stage === stage.id ? 'step' : undefined} onClick={() => navigate(next)}>{stage.label}</button>)}</div>
    <button type="button" disabled={index === 0} onClick={() => navigate(index - 1)}>上一阶段</button>
    <button type="button" disabled={index === BRAINSTORM_STAGES.length - 1} onClick={() => navigate(index + 1)}>下一阶段</button>
    <button type="button" onClick={() => {
      onChange({ ...session, aiPaused: false, updatedAt: new Date().toISOString() })
      setNotice('当前阶段已重启')
    }}>重启当前阶段</button>
    {notice && <span role="status">{notice}</span>}
  </nav>
}
