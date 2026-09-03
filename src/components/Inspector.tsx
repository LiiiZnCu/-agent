import { BracketsCurly, Copy, ThumbsUp, Trash, X } from '@phosphor-icons/react'
import type { BoardNode, ElementColor } from '../types'

const COLORS: ElementColor[] = ['paper', 'sun', 'mint', 'sky', 'rose']

type Props = {
  node: BoardNode
  onUpdate: (id: string, patch: Partial<BoardNode['data']>) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onClose: () => void
  onCopySpec: (id: string) => void
}

export function Inspector({ node, onUpdate, onDelete, onDuplicate, onClose, onCopySpec }: Props) {
  const isArtifact = node.data.kind === 'artifact' && node.data.artifact

  return (
    <aside className="inspector-panel" aria-label="Element inspector">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">Selected element</span>
          <h2>{isArtifact ? 'Artifact settings' : 'Edit content'}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close inspector"><X size={18} /></button>
      </div>

      {isArtifact ? (
        <>
          <div className="spec-summary">
            <div><span>Type</span><strong>{node.data.artifact!.artifactType}</strong></div>
            <div><span>Fields</span><strong>{node.data.artifact!.fields.length}</strong></div>
            <div><span>Records</span><strong>{node.data.artifact!.records.length}</strong></div>
          </div>
          <div className="field-block">
            <label>Artifact Spec 1.0</label>
            <div className="spec-code">
              {node.data.artifact!.fields.map((field) => (
                <div key={field.key}><code>{field.key}</code><span>{field.type}</span></div>
              ))}
            </div>
            <p className="field-help">Agents can read this schema and update its primitive records without guessing the layout.</p>
          </div>
          <button type="button" className="secondary-button full-width" onClick={() => onCopySpec(node.id)}>
            <BracketsCurly size={17} />Copy JSON spec
          </button>
        </>
      ) : (
        <>
          <div className="field-block">
            <label htmlFor="element-title">Title</label>
            <input
              id="element-title"
              value={node.data.title}
              maxLength={120}
              onChange={(event) => onUpdate(node.id, { title: event.target.value })}
            />
          </div>
          <div className="field-block">
            <label htmlFor="element-body">Details</label>
            <textarea
              id="element-body"
              value={node.data.body}
              maxLength={800}
              rows={5}
              onChange={(event) => onUpdate(node.id, { body: event.target.value })}
            />
          </div>
          {node.data.kind !== 'frame' && (
            <div className="field-block">
              <label>Color</label>
              <div className="color-options">
                {COLORS.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={`color-option color-${color} ${node.data.color === color ? 'is-selected' : ''}`}
                    onClick={() => onUpdate(node.id, { color })}
                    aria-label={`Use ${color} color`}
                    aria-pressed={node.data.color === color}
                  />
                ))}
              </div>
            </div>
          )}
          {node.data.kind !== 'frame' && (
            <button type="button" className="vote-button" onClick={() => onUpdate(node.id, { votes: node.data.votes + 1 })}>
              <ThumbsUp size={17} weight="bold" />Add vote <span>{node.data.votes}</span>
            </button>
          )}
        </>
      )}

      <div className="inspector-actions">
        <button type="button" className="secondary-button" onClick={() => onDuplicate(node.id)}><Copy size={17} />Duplicate</button>
        <button type="button" className="danger-button" onClick={() => onDelete(node.id)}><Trash size={17} />Delete</button>
      </div>
    </aside>
  )
}
