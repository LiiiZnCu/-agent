import { useEffect, useRef, useState } from 'react'
import type { BoardActions, BoardNode, BrainstormSession, SuggestionReason } from '../types'
import { ProposalEditor } from './ProposalEditor'
import { DecisionEditor } from './DecisionEditor'
import { OutcomeEditor } from './OutcomeEditor'
import { MemberControls } from './MemberControls'
import { SuggestionCard } from './SuggestionCard'
import { ignoreSuggestion, isStagePaused, pauseStage, visibleSuggestions } from '../lib/brainstorm-actions'
import { validateBrainstormAction } from '../lib/brainstorm-validation'

export function BrainstormPanel({ session, nodes, actions, onChange, onRequest, onAccept, onUndo }: { session: BrainstormSession; nodes: BoardNode[]; actions: BoardActions; onChange: (session: BrainstormSession) => void; onRequest: (reason: SuggestionReason, ids: string[]) => Promise<boolean>; onAccept: (id: string) => void; onUndo: (id: string) => void }) {
  const [helpStatus, setHelpStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const available = visibleSuggestions(session)
  const paused = isStagePaused(session)
  const selected = nodes.filter((node) => node.selected && node.data.ideaMeta?.sessionId === session.id).map((node) => node.id)
  const update = (next: BrainstormSession) => onChange({ ...next, updatedAt: new Date().toISOString() })
  const run = (operation: () => void) => { setHelpStatus(''); try { operation(); return true } catch (error) { setHelpStatus(error instanceof Error ? error.message : '建议操作失败。'); return false } }
  const request = async (reason: SuggestionReason) => {
    setBusy(true); setHelpStatus('正在请求 AI 建议…')
    try { const shown = await onRequest(reason, selected); if (mounted.current) setHelpStatus(shown ? '' : '本阶段已忽略这类建议。') }
    catch (error) { if (mounted.current) setHelpStatus(`AI 请求失败：${error instanceof Error ? error.message : '网络或服务端错误。'}`) }
    finally { if (mounted.current) setBusy(false) }
  }
  const revise = (next: BrainstormSession) => onChange({ ...next, updatedAt: new Date().toISOString(), decision: next.decision ? { ...next.decision, confirmedAt: undefined, confirmedBy: undefined } : null })
  return <aside className="brainstorm-panel" aria-label="讨论与 AI">
    <h2>讨论与 AI</h2><p>{session.goal}</p>
    <MemberControls session={session} onChange={onChange} />
    <label><input type="checkbox" checked={paused} onChange={(event) => update(pauseStage(session, event.target.checked))} />暂停 AI</label>
    {paused && <p>仅暂停当前阶段，其他阶段仍可求助。</p>}
    <button type="button" disabled={paused || busy || available.length > 0} onClick={() => void request('quiet_period')}>需要帮助</button>
    <button type="button" disabled={paused || busy || available.length > 0 || selected.length < 1} onClick={() => void request('similar_ideas')}>智能归类选中观点</button>
    <button type="button" disabled={paused || busy || available.length > 0 || selected.length < 2} onClick={() => void request('complementary_ideas')}>整合选中观点</button>
    {helpStatus && <p role="status">{helpStatus}</p>}
    <section aria-label="AI 建议"><h3>AI 建议</h3>{available.length === 0 && <p>暂无 AI 建议</p>}
      {available.slice(0, 1).map((suggestion) => <SuggestionCard key={suggestion.id} suggestion={suggestion} nodes={nodes} busy={busy} onAccept={() => run(() => onAccept(suggestion.id))} onPause={() => update(pauseStage(session, true))} onStatus={(status) => run(() => update(status === 'ignored' ? ignoreSuggestion(session, suggestion.id) : { ...session, suggestions: session.suggestions.map((item) => item.id === suggestion.id ? { ...item, status } : item) }))} onSave={(edited) => run(() => {
        if (!edited.message.trim()) throw new Error('建议说明不能为空。')
        edited.actions.forEach((action) => validateBrainstormAction(action, actions.getSnapshot(), session.id))
        update({ ...session, suggestions: session.suggestions.map((item) => item.id === suggestion.id ? edited : item) })
      })} />)}
      {session.suggestions.filter((item) => item.status === 'accepted').map((item) => <section key={item.id}><p>已接受：{item.message}</p><button type="button" disabled={busy} onClick={() => run(() => onUndo(item.id))}>撤销 AI 动作</button></section>)}
    </section>
    <ProposalEditor session={session} nodes={nodes} onChange={revise} actions={actions} />
    {session.stage === 'deciding' && <DecisionEditor session={session} onChange={revise} actions={actions} />}
    {(session.stage === 'output' || session.outcome !== null) && <OutcomeEditor session={session} onChange={onChange} />}
  </aside>
}
