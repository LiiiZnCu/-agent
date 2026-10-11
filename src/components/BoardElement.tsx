import {
  BracketsCurly,
  Check,
  CheckCircle,
  FrameCorners,
  Lightbulb,
  MagnifyingGlass,
  QuestionMark,
  Sparkle,
  Table,
  ThumbsUp,
} from '@phosphor-icons/react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import { AGENT_COLOR_HEX } from '../lib/recording'
import type { AgentColor, ArtifactField, ArtifactSpec, ArtifactValue, BoardNode, ElementKind } from '../types'

const KIND_META: Record<ElementKind, { label: string; icon: typeof Lightbulb }> = {
  idea: { label: '观点', icon: Lightbulb },
  question: { label: '问题', icon: QuestionMark },
  insight: { label: '洞察', icon: MagnifyingGlass },
  action: { label: '行动', icon: CheckCircle },
  frame: { label: '分类框', icon: FrameCorners },
  artifact: { label: '结构化成果', icon: Table },
}

function formatValue(value: ArtifactValue, field: ArtifactField) {
  if (field.type === 'boolean') {
    return value ? <Check weight="bold" aria-label="已完成" /> : <span className="artifact-empty-check" aria-label="未完成" />
  }
  if (value === null || value === undefined || value === '') return <span className="artifact-empty">空</span>
  if (field.type === 'status' || field.type === 'tag') return <span className="artifact-tag">{String(value)}</span>
  if (field.type === 'url' && typeof value === 'string' && /^https?:\/\//.test(value)) {
    return <a href={value} target="_blank" rel="noreferrer" className="artifact-link">打开</a>
  }
  return String(value)
}

function ArtifactView({ spec }: { spec: ArtifactSpec }) {
  const visibleKeys = spec.presentation.visibleFields?.length
    ? spec.presentation.visibleFields
    : spec.fields.map((field) => field.key)
  const fields = visibleKeys
    .map((key) => spec.fields.find((field) => field.key === key))
    .filter((field): field is ArtifactField => Boolean(field))

  if (!spec.records.length) {
    return <div className="artifact-empty-state">暂无记录。智能体可以添加结构化数据。</div>
  }

  if (spec.presentation.layout === 'grid') {
    return (
      <div className="artifact-card-grid">
        {spec.records.slice(0, 6).map((record, index) => (
          <div className="artifact-card" key={index}>
            {fields.map((field, fieldIndex) => (
              <div className={fieldIndex === 0 ? 'artifact-card-title' : 'artifact-card-field'} key={field.key}>
                {fieldIndex > 0 && <span>{field.label}</span>}
                <strong>{formatValue(record[field.key] ?? null, field)}</strong>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (spec.presentation.layout === 'list') {
    return (
      <div className="artifact-list">
        {spec.records.slice(0, 8).map((record, index) => (
          <div className="artifact-list-row" key={index}>
            {fields.map((field) => (
              <div className={`artifact-list-value field-${field.type}`} key={field.key}>
                {formatValue(record[field.key] ?? null, field)}
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={`artifact-table-wrap density-${spec.presentation.density ?? 'comfortable'}`}>
      <table className="artifact-table">
        <thead>
          <tr>{fields.map((field) => <th key={field.key}>{field.label}</th>)}</tr>
        </thead>
        <tbody>
          {spec.records.slice(0, 8).map((record, index) => (
            <tr key={index}>
              {fields.map((field) => <td key={field.key}>{formatValue(record[field.key] ?? null, field)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function BoardElement({ data, selected }: NodeProps<BoardNode>) {
  const meta = KIND_META[data.kind]
  const Icon = meta.icon
  const isFrame = data.kind === 'frame'
  const isArtifact = data.kind === 'artifact' && data.artifact
  const focus = data._focusPresence as { participantName: string; intent: string; color: AgentColor; state: 'editing' | 'reviewing' } | undefined

  return (
    <div
      className={`board-element kind-${data.kind} color-${data.color} ${selected ? 'is-selected' : ''} ${data.justCreated ? 'is-new' : ''} ${focus ? `has-agent-focus focus-${focus.state}` : ''}`}
      style={focus ? { '--agent-focus-color': AGENT_COLOR_HEX[focus.color] } as CSSProperties : undefined}
      data-testid={`board-element-${data.kind}`}
    >
      {focus && <div className="agent-focus-badge" title={focus.intent}><span />{focus.participantName} {focus.state === 'editing' ? '正在编辑' : '正在查看'}</div>}
      <NodeResizer
        color="#f06449"
        isVisible={selected}
        minWidth={isFrame ? 320 : isArtifact ? 390 : 190}
        minHeight={isFrame ? 220 : isArtifact ? 220 : 118}
        handleStyle={{ width: 9, height: 9, borderRadius: 2 }}
      />
      {!isFrame && <Handle type="target" position={Position.Left} className="element-handle" />}
      <header className="element-header">
        <span className="element-kind"><Icon size={14} weight="bold" />{meta.label}</span>
        {isArtifact ? (
          <span className="artifact-spec-label"><BracketsCurly size={13} />结构说明 1.0</span>
        ) : data.cluster ? <span className="element-cluster">{data.cluster}</span> : null}
      </header>

      {isArtifact ? (
        <>
          <div className="artifact-heading">
            <div>
              <h3>{data.artifact!.title}</h3>
              {data.artifact!.description && <p>{data.artifact!.description}</p>}
            </div>
            <span className="artifact-count">{data.artifact!.records.length} 条记录</span>
          </div>
          <ArtifactView spec={data.artifact!} />
        </>
      ) : (
        <>
          <h3>{data.title}</h3>
          {data.body && <p>{data.body}</p>}
          {!isFrame && (
            <footer className="element-footer">
              <span className={data.votes > 0 ? 'vote-count has-votes' : 'vote-count'}>
                <ThumbsUp size={14} weight={data.votes > 0 ? 'fill' : 'regular'} /> {data.votes}
              </span>
              {data.kind === 'insight' && <Sparkle size={14} weight="fill" aria-label="重点洞察" />}
            </footer>
          )}
        </>
      )}
      {!isFrame && <Handle type="source" position={Position.Right} className="element-handle" />}
    </div>
  )
}
