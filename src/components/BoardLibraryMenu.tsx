import { ArrowSquareOut, CaretDown, Check, FolderOpen, Plus, UploadSimple } from '@phosphor-icons/react'
import type { BoardSummary } from '../types'

type Props = {
  boards: BoardSummary[]
  currentId: string
  onNew: () => void
  onSelect: (id: string) => void
  onOpenInstance: (id: string) => void
  onImport: (file: File) => void
}

function boardDate(timestamp: string) {
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function BoardLibraryMenu({ boards, currentId, onNew, onSelect, onOpenInstance, onImport }: Props) {
  const closeMenu = (target: HTMLElement) => target.closest('details')?.removeAttribute('open')
  return (
    <details className="board-library-menu top-menu">
      <summary className="secondary-button"><FolderOpen size={17} />Murals<CaretDown size={13} /></summary>
      <div className="board-library-popover">
        <div className="library-heading">
          <div><strong>Your murals</strong><span>{boards.length} saved locally</span></div>
          <button type="button" className="icon-button" onClick={(event) => { onNew(); closeMenu(event.currentTarget) }} aria-label="Create a new mural"><Plus size={17} /></button>
        </div>
        <div className="board-history-list">
          {boards.map((board) => (
            <div className={`board-history-row ${board.id === currentId ? 'is-current' : ''}`} key={board.id}>
              <button type="button" className="board-history-select" onClick={(event) => { onSelect(board.id); closeMenu(event.currentTarget) }}>
                <span className="board-history-mark">{board.id === currentId ? <Check size={13} weight="bold" /> : board.name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{board.name}</strong><small>{board.elementCount} elements, {boardDate(board.updatedAt)}</small><code>{board.id.slice(0, 8)}</code></span>
              </button>
              <button type="button" className="board-instance-button" onClick={(event) => { onOpenInstance(board.id); closeMenu(event.currentTarget) }} aria-label={`Open ${board.name} in a separate instance`} title="Open separate instance"><ArrowSquareOut size={15} /></button>
            </div>
          ))}
        </div>
        <label className="import-board-button">
          <UploadSimple size={16} />Import mural JSON
          <input type="file" accept="application/json,.json" onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onImport(file)
            closeMenu(event.currentTarget)
            event.target.value = ''
          }} />
        </label>
      </div>
    </details>
  )
}
