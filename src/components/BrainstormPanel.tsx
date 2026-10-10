import { useState } from 'react'
import type { BoardActions, BoardNode, BrainstormSession } from '../types'
import { ProposalEditor } from './ProposalEditor'
import { DecisionEditor } from './DecisionEditor'
import { OutcomeEditor } from './OutcomeEditor'
import { MemberControls } from './MemberControls'

export function BrainstormPanel({ session, nodes, actions, onChange }: { session: BrainstormSession; nodes: BoardNode[]; actions: BoardActions; onChange: (session: BrainstormSession) => void }) {
  const [helpStatus, setHelpStatus] = useState('')
  const revise = (next: BrainstormSession) => onChange({ ...next, updatedAt: new Date().toISOString(), decision: next.decision ? { ...next.decision, confirmedAt: undefined, confirmedBy: undefined } : null })
  return <aside className="brainstorm-panel" aria-label="讨论与 AI">
    <h2>讨论与 AI</h2><p>{session.goal}</p>
    <MemberControls session={session} onChange={onChange} />
    <label><input type="checkbox" checked={session.aiPaused ?? false} onChange={(event) => onChange({ ...session, aiPaused: event.target.checked })} />暂停 AI</label>
    <button type="button" disabled={session.aiPaused} onClick={() => setHelpStatus('AI 服务未连接，暂时无法请求帮助。')}>需要帮助</button>
    {helpStatus && <p role="status">{helpStatus}</p>}
    <section aria-label="AI 建议"><h3>AI 建议</h3>{session.suggestions.length === 0 && <p>暂无 AI 建议</p>}</section>
    <ProposalEditor session={session} nodes={nodes} onChange={revise} actions={actions} />
    {session.stage === 'deciding' && <DecisionEditor session={session} onChange={revise} actions={actions} />}
    {session.stage === 'output' && <OutcomeEditor session={session} onChange={onChange} />}
  </aside>
}
