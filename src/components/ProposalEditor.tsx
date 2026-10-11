import { useState } from 'react'
import { createId } from '../lib/board'
import type { BoardActions, BoardNode, BrainstormSession, Proposal } from '../types'

const COMMENT_LABELS: Record<Proposal['comments'][number]['kind'], string> = { support: '支持', oppose: '反对', supplement: '补充', risk: '风险', verify: '待验证' }

function ProposalCard({ proposal, session, nodes, onChange }: { proposal: Proposal; session: BrainstormSession; nodes: BoardNode[]; onChange: (session: BrainstormSession) => void }) {
  const [comment, setComment] = useState('')
  const [kind, setKind] = useState<Proposal['comments'][number]['kind']>('support')
  const update = (patch: Partial<Proposal>) => {
    const next = { ...proposal, ...patch }
    onChange({ ...session, proposals: session.proposals.map((item) => item.id === proposal.id ? next : item) })
  }
  return <section className="proposal-card" aria-label={`方案：${proposal.title}`}>
    <span className="proposal-author">{session.members.find((member) => member.id === proposal.authorId)?.name ?? proposal.authorId}</span>
    <label>方案标题<input value={proposal.title} onChange={(event) => update({ title: event.target.value })} /></label>
    <label>方案说明<textarea value={proposal.description} onChange={(event) => update({ description: event.target.value })} /></label>
    <label>组合逻辑<textarea value={proposal.integrationLogic} onChange={(event) => update({ integrationLogic: event.target.value })} /></label>
    <label>方案风险<textarea value={proposal.risks.join('\n')} onChange={(event) => update({ risks: event.target.value.split('\n') })} /></label>
    <label>待确认事项<textarea value={proposal.openQuestions.join('\n')} onChange={(event) => update({ openQuestions: event.target.value.split('\n') })} /></label>
    <fieldset><legend>来源观点</legend>{nodes.filter((node) => node.id !== proposal.id && node.data.ideaMeta?.sessionId === session.id && node.data.ideaMeta.type !== 'proposal').map((node) => <label key={node.id}>
      <input type="checkbox" checked={proposal.sourceIdeaIds.includes(node.id)} onChange={(event) => update({ sourceIdeaIds: event.target.checked ? [...proposal.sourceIdeaIds, node.id] : proposal.sourceIdeaIds.filter((id) => id !== node.id) })} />{node.data.title || '未填写标题'}
    </label>)}</fieldset>
    <p>状态：{proposal.status === 'accepted' ? '已接受' : proposal.status === 'rejected' ? '已拒绝' : '草稿'}</p>
    <div className="discussion-actions"><button type="button" disabled={!proposal.title.trim()} onClick={() => update({ status: 'accepted' })}>接受方案</button><button type="button" onClick={() => update({ status: 'rejected' })}>拒绝方案</button><button type="button" onClick={() => update({ status: 'draft' })}>恢复草稿</button></div>
    <h4>所有意见（含少数意见）</h4>
    {proposal.comments.map((item) => <article className="proposal-comment" key={item.id}><span>{COMMENT_LABELS[item.kind]} · {session.members.find((member) => member.id === item.authorId)?.name ?? item.authorId}</span><p>{item.content}</p><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('zh-CN')}</time></article>)}
    <form onSubmit={(event) => {
      event.preventDefault()
      if (!comment.trim()) return
      update({ comments: [...proposal.comments, { id: createId('comment'), authorId: session.currentMemberId, kind, content: comment.trim(), createdAt: new Date().toISOString() }] })
      setComment('')
    }}>
      <label>评论类型<select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>{Object.entries(COMMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>评论内容<textarea value={comment} onChange={(event) => setComment(event.target.value)} /></label>
      <button disabled={!comment.trim()}>添加方案评论</button>
    </form>
  </section>
}

export function ProposalEditor({ session, nodes, onChange, actions }: { session: BrainstormSession; nodes: BoardNode[]; onChange: (session: BrainstormSession) => void; actions: BoardActions }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  return <section aria-label="候选方案">
    <h3>候选方案</h3>
    <form onSubmit={(event) => {
      event.preventDefault()
      if (!title.trim()) return
      actions.addElement({ title: title.trim(), body: description.trim(), kind: 'idea', ideaType: 'proposal' }, 'human')
      setTitle(''); setDescription('')
    }}><label>新方案标题<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>新方案说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label><button disabled={!title.trim()}>添加候选方案</button></form>
    {session.proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} session={session} nodes={nodes} onChange={onChange} />)}
  </section>
}
