import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowsOutSimple, BracketsCurly, ChatCircleText, Copy, Minus, PaperPlaneTilt, Stack, ThumbsUp, Trash, X } from '@phosphor-icons/react'
import type { BoardNode, BrainstormMember, ElementColor, LayerAction, RecordingEvent } from '../types'
import { IDEA_LABELS } from '../lib/brainstorm'

const COLORS: ElementColor[] = ['paper', 'sun', 'mint', 'sky', 'rose']

type Props = {
  node: BoardNode
  members?: BrainstormMember[]
  minimized: boolean
  onToggleMinimized: () => void
  onUpdate: (id: string, patch: Partial<BoardNode['data']>) => void
  onCommit: (id: string, field: string) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onClose: () => void
  onCopySpec: (id: string) => void
  onLayer: (action: LayerAction) => void
  comments: RecordingEvent[]
  onComment: (content: string) => void
}

export function Inspector({ node, members = [], minimized, onToggleMinimized, onUpdate, onCommit, onDelete, onDuplicate, onClose, onCopySpec, onLayer, comments, onComment }: Props) {
  const isArtifact = node.data.kind === 'artifact' && node.data.artifact
  const [comment, setComment] = useState('')
  const [activeTab, setActiveTab] = useState<'content' | 'comments'>('content')
  const [hasVoted, setHasVoted] = useState(() => window.localStorage.getItem(`canvas-relay-vote:${node.id}`) === 'true')

  return (
    <aside className={`inspector-panel ${minimized ? 'is-minimized' : ''}`} aria-label="元素检查器">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">已选元素</span>
          <h2>{minimized ? node.data.title : isArtifact ? '成果设置' : '编辑内容'}</h2>
        </div>
        <div className="inspector-heading-actions">
          <button type="button" className={`icon-button inspector-comment-toggle ${activeTab === 'comments' ? 'is-active' : ''}`} onClick={() => { setActiveTab('comments'); if (minimized) onToggleMinimized() }} aria-label={`${comments.length} 条评论`} aria-pressed={activeTab === 'comments'}>
            <ChatCircleText size={17} /><span>{comments.length}</span>
          </button>
          <button type="button" className="icon-button" onClick={onToggleMinimized} aria-label={minimized ? '展开检查器' : '收起检查器'} aria-expanded={!minimized}>
            {minimized ? <ArrowsOutSimple size={17} /> : <Minus size={17} weight="bold" />}
          </button>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭检查器"><X size={18} /></button>
        </div>
      </div>

      {!minimized && <nav className="inspector-tabs" aria-label="元素面板分区">
        <button type="button" className={activeTab === 'content' ? 'is-active' : ''} onClick={() => setActiveTab('content')}>内容</button>
        <button type="button" className={activeTab === 'comments' ? 'is-active' : ''} onClick={() => setActiveTab('comments')}><ChatCircleText size={15} />评论 <span>{comments.length}</span></button>
      </nav>}

      {!minimized && node.data.ideaMeta && <section className="idea-metadata" aria-label="观点信息">
        <dl><dt>作者</dt><dd>{members.find((member) => member.id === node.data.ideaMeta!.authorId)?.name ?? node.data.ideaMeta.authorId}</dd>
          <dt>类型</dt><dd>{IDEA_LABELS[node.data.ideaMeta.type]}</dd>
          <dt>创建时间</dt><dd><time dateTime={node.data.ideaMeta.createdAt}>{new Date(node.data.ideaMeta.createdAt).toLocaleString('zh-CN')}</time></dd>
          <dt>来源</dt><dd>{node.data.ideaMeta.sourceIdeaIds.length ? node.data.ideaMeta.sourceIdeaIds.join('、') : '直接创建'}</dd>
          <dt>修改记录</dt><dd>版本 {node.data.ideaMeta.versions.length + 1}</dd></dl>
        {node.data.ideaMeta.versions.map((version, index) => <p key={index}>{members.find((member) => member.id === version.authorId)?.name ?? version.authorId} · <time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString('zh-CN')}</time></p>)}
      </section>}

      {!minimized && activeTab === 'content' && (isArtifact ? (
        <>
          <div className="spec-summary">
            <div><span>类型</span><strong>{node.data.artifact!.artifactType}</strong></div>
            <div><span>字段</span><strong>{node.data.artifact!.fields.length}</strong></div>
            <div><span>记录</span><strong>{node.data.artifact!.records.length}</strong></div>
          </div>
          <div className="field-block">
            <label>成果结构说明 1.0</label>
            <div className="spec-code">
              {node.data.artifact!.fields.map((field) => (
                <div key={field.key}><code>{field.key}</code><span>{field.type}</span></div>
              ))}
            </div>
            <p className="field-help">智能体可读取此结构并更新记录，无需猜测布局。</p>
          </div>
          <button type="button" className="secondary-button full-width" onClick={() => onCopySpec(node.id)}>
            <BracketsCurly size={17} />复制 JSON 结构
          </button>
        </>
      ) : (
        <>
          <div className="field-block">
            <label htmlFor="element-title">标题</label>
            <input
              id="element-title"
              value={node.data.title}
              maxLength={120}
              onChange={(event) => onUpdate(node.id, { title: event.target.value })}
              onBlur={() => onCommit(node.id, 'title changed')}
            />
          </div>
          <div className="field-block">
            <label htmlFor="element-body">详情</label>
            <textarea
              id="element-body"
              value={node.data.body}
              maxLength={800}
              rows={5}
              onChange={(event) => onUpdate(node.id, { body: event.target.value })}
              onBlur={() => onCommit(node.id, 'details changed')}
            />
          </div>
          {node.data.kind !== 'frame' && (
            <div className="field-block">
              <label>颜色</label>
              <div className="color-options">
                {COLORS.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={`color-option color-${color} ${node.data.color === color ? 'is-selected' : ''}`}
                    onClick={() => { onUpdate(node.id, { color }); onCommit(node.id, `color changed to ${color}`) }}
                    aria-label={`使用 ${({ paper: '纸白', sun: '暖黄', mint: '薄荷绿', sky: '天蓝', rose: '玫瑰粉' } as const)[color]}颜色`}
                    aria-pressed={node.data.color === color}
                  />
                ))}
              </div>
            </div>
          )}
          {node.data.kind !== 'frame' && (
            <button type="button" className={`vote-button ${hasVoted ? 'has-voted' : ''}`} disabled={hasVoted} onClick={() => {
              if (hasVoted) return
              window.localStorage.setItem(`canvas-relay-vote:${node.id}`, 'true')
              setHasVoted(true)
              onUpdate(node.id, { votes: node.data.votes + 1 })
              onCommit(node.id, 'vote added')
            }}>
              <ThumbsUp size={17} weight={hasVoted ? 'fill' : 'bold'} />{hasVoted ? '已投票' : '投票'} <span>{node.data.votes}</span>
            </button>
          )}
        </>
      ))}

      {!minimized && activeTab === 'content' && <div className="field-block layer-controls">
        <div className="layer-heading"><label>层级</label><span>z {node.zIndex ?? 0}</span></div>
        <div className="layer-button-grid">
          <button type="button" onClick={() => onLayer('front')}><Stack size={16} />置于最前</button>
          <button type="button" onClick={() => onLayer('forward')}><ArrowUp size={16} />上移一层</button>
          <button type="button" onClick={() => onLayer('backward')}><ArrowDown size={16} />下移一层</button>
          <button type="button" onClick={() => onLayer('back')}><Stack size={16} />置于最后</button>
        </div>
        <p className="field-help">右键单击元素也可调整层级。</p>
      </div>}

      {!minimized && activeTab === 'comments' && <section className="element-comments is-tab-panel">
        <div className="element-comments-heading"><ChatCircleText size={15} /><strong>评论</strong><span>{comments.length}</span></div>
        {comments.length > 0 && <div className="element-comment-list">{[...comments].reverse().slice(0, 6).map((item) => (
          <article key={item.id}><strong>{item.participantName}</strong><span>{item.kind}</span><p>{item.content}</p></article>
        ))}</div>}
        <form onSubmit={(event) => {
          event.preventDefault()
          const content = comment.trim()
          if (!content) return
          onComment(content)
          setComment('')
        }}>
          <input value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} placeholder="评论此元素" aria-label="评论此元素" />
          <button type="submit" disabled={!comment.trim()} aria-label="添加评论"><PaperPlaneTilt size={15} weight="fill" /></button>
        </form>
        <p className="field-help">评论将在这里和共享讨论中显示。</p>
      </section>}

      {!minimized && activeTab === 'content' && <div className="inspector-actions">
        <button type="button" className="secondary-button" onClick={() => onDuplicate(node.id)}><Copy size={17} />复制</button>
        <button type="button" className="danger-button" onClick={() => onDelete(node.id)}><Trash size={17} />删除</button>
      </div>}
    </aside>
  )
}
