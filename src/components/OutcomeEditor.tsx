import type { BrainstormSession } from '../types'

export function OutcomeEditor({ session, onChange }: { session: BrainstormSession; onChange: (session: BrainstormSession) => void }) {
  const decision = session.decision ?? { criteria: [], scores: [], votes: [] }
  const outcome = session.outcome ?? { draft: '', actions: [], updatedAt: session.updatedAt }
  const selected = session.proposals.find((proposal) => proposal.id === decision.finalProposalId && proposal.status === 'accepted')
  const confirmed = Boolean(selected && outcome.draft.trim() && decision.confirmedAt && decision.confirmedBy && outcome.finalProposalId === selected.id)
  return <section aria-label="讨论成果"><h3>成果草稿</h3>
    <label>成果草稿<textarea rows={8} value={outcome.draft} onChange={(event) => onChange({ ...session, outcome: { ...outcome, draft: event.target.value, updatedAt: new Date().toISOString() }, decision: { ...decision, confirmedAt: undefined, confirmedBy: undefined } })} /></label>
    <label>最终方案<select value={decision.finalProposalId ?? ''} onChange={(event) => onChange({ ...session, decision: { ...decision, finalProposalId: event.target.value || undefined, confirmedAt: undefined, confirmedBy: undefined } })}><option value="">请选择已接受的方案</option>{session.proposals.filter((proposal) => proposal.status === 'accepted').map((proposal) => <option key={proposal.id} value={proposal.id}>{proposal.title}</option>)}</select></label>
    <button type="button" disabled={!selected || !outcome.draft.trim()} onClick={() => onChange({ ...session, outcome: { ...outcome, finalProposalId: selected!.id }, decision: { ...decision, confirmedBy: session.currentMemberId, confirmedAt: new Date().toISOString() } })}>确认最终结果</button>
    <p>{confirmed ? '最终结果已确认' : '确认最终方案和草稿后才能导出'}</p>
    <button type="button" disabled={!confirmed} onClick={() => {
      if (!confirmed) return
      const url = URL.createObjectURL(new Blob([outcome.draft], { type: 'text/markdown;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = 'discussion-outcome.md'; anchor.click()
      URL.revokeObjectURL(url)
    }}>导出讨论成果</button>
  </section>
}
