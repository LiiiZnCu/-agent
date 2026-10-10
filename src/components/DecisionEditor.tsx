import { useState } from 'react'
import { createId } from '../lib/board'
import type { ArtifactValue, BoardActions, BrainstormSession, DecisionMatrix } from '../types'

function ScoreForm({ proposalId, criterionId, session, onChange }: { proposalId: string; criterionId: string; session: BrainstormSession; onChange: (decision: DecisionMatrix) => void }) {
  const current = session.decision?.scores.find((item) => item.proposalId === proposalId && item.criterionId === criterionId && item.memberId === session.currentMemberId)
  const [score, setScore] = useState(current ? String(current.score) : '')
  const [reason, setReason] = useState(current?.reason ?? '')
  return <form onSubmit={(event) => {
    event.preventDefault()
    if (!score.trim() || !Number.isFinite(Number(score)) || Number(score) < 0 || Number(score) > 10 || !reason.trim()) return
    const decision = session.decision!
    onChange({ ...decision, scores: [...decision.scores.filter((item) => !(item.proposalId === proposalId && item.criterionId === criterionId && item.memberId === session.currentMemberId)), { proposalId, criterionId, memberId: session.currentMemberId, score: Number(score), reason: reason.trim() }] })
  }}><label>评分<input type="number" required min="0" max="10" step="any" value={score} onChange={(event) => setScore(event.target.value)} /></label><label>评分理由<textarea required value={reason} onChange={(event) => setReason(event.target.value)} /></label><button disabled={!score.trim() || !reason.trim()}>保存评分</button></form>
}

export function DecisionEditor({ session, onChange, actions }: { session: BrainstormSession; onChange: (session: BrainstormSession) => void; actions: BoardActions }) {
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('')
  const decision = session.decision ?? { criteria: [], scores: [], votes: [] }
  const update = (next: DecisionMatrix) => onChange({ ...session, decision: next })
  return <section aria-label="人工决策"><h3>决策标准与评分</h3>
    <form onSubmit={(event) => {
      event.preventDefault()
      if (!name.trim() || !weight.trim() || !Number.isFinite(Number(weight)) || Number(weight) <= 0) return
      update({ ...decision, criteria: [...decision.criteria, { id: createId('criterion'), name: name.trim(), weight: Number(weight) }] })
      setName(''); setWeight('')
    }}><label>新标准名称<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>新标准权重<input type="number" required min="0.01" step="any" value={weight} onChange={(event) => setWeight(event.target.value)} /></label><button disabled={!name.trim() || !weight.trim()}>添加决策标准</button></form>
    {decision.criteria.map((criterion) => <section key={criterion.id} className="decision-criterion">
      <label>标准名称<input value={criterion.name} onChange={(event) => update({ ...decision, criteria: decision.criteria.map((item) => item.id === criterion.id ? { ...item, name: event.target.value } : item) })} /></label>
      <label>标准权重<input type="number" min="0.01" step="any" value={criterion.weight} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) update({ ...decision, criteria: decision.criteria.map((item) => item.id === criterion.id ? { ...item, weight: value } : item) }) }} /></label>
      {session.proposals.map((proposal) => <div key={proposal.id}><strong>{proposal.title}</strong><ScoreForm key={`${proposal.id}:${criterion.id}:${session.currentMemberId}`} proposalId={proposal.id} criterionId={criterion.id} session={session} onChange={update} />
        {decision.scores.filter((item) => item.proposalId === proposal.id && item.criterionId === criterion.id).map((item) => <article key={item.memberId}><span>{session.members.find((member) => member.id === item.memberId)?.name ?? item.memberId}：{item.score}</span><p>{item.reason}</p></article>)}
      </div>)}
    </section>)}
    {session.proposals.map((proposal) => {
      const voted = decision.votes.some((vote) => vote.memberId === session.currentMemberId && vote.proposalId === proposal.id)
      return <div key={proposal.id}><strong>{proposal.title}</strong><p>票数：{decision.votes.filter((vote) => vote.proposalId === proposal.id).length}</p><button type="button" onClick={() => update({ ...decision, votes: [...decision.votes.filter((vote) => vote.memberId !== session.currentMemberId), ...(voted ? [] : [{ memberId: session.currentMemberId, proposalId: proposal.id }])] })}>{voted ? '撤回我的投票' : '投票支持此方案'}</button></div>
    })}
    <button type="button" disabled={!decision.criteria.length || !session.proposals.length || decision.criteria.some((item) => !item.name.trim())} onClick={() => actions.createArtifact({
      specVersion: '1.0', artifactType: 'matrix', title: `${session.topic} · 决策矩阵`,
      fields: [{ key: 'proposal', label: '方案', type: 'text' }, { key: 'criterion', label: '标准', type: 'text' }, { key: 'weight', label: '权重', type: 'number' }, { key: 'member', label: '成员', type: 'text' }, { key: 'score', label: '评分', type: 'number' }, { key: 'reason', label: '理由', type: 'text' }],
      records: session.proposals.flatMap((proposal) => decision.criteria.flatMap<Record<string, ArtifactValue>>((criterion) => {
        const scores = decision.scores.filter((item) => item.proposalId === proposal.id && item.criterionId === criterion.id)
        return scores.length ? scores.map((score) => ({ proposal: proposal.title, criterion: criterion.name, weight: criterion.weight, member: session.members.find((member) => member.id === score.memberId)?.name ?? score.memberId, score: score.score, reason: score.reason })) : [{ proposal: proposal.title, criterion: criterion.name, weight: criterion.weight, member: '', score: null, reason: '' }]
      })), presentation: { layout: 'table' },
    }, undefined, undefined, 'human')}>放入白板矩阵</button>
  </section>
}
