import { ArrowDown, ArrowUp, Copy, Stack, Trash } from '@phosphor-icons/react'
import type { LayerAction } from '../types'

type Props = {
  x: number
  y: number
  title: string
  onLayer: (action: LayerAction) => void
  onDuplicate: () => void
  onDelete: () => void
}

export function LayerMenu({ x, y, title, onLayer, onDuplicate, onDelete }: Props) {
  return (
    <div className="layer-context-menu" role="menu" style={{ left: x, top: y }} aria-label={`Arrange ${title}`}>
      <div className="layer-menu-title"><Stack size={15} /><span>Layer</span><strong>{title}</strong></div>
      <button type="button" role="menuitem" onClick={() => onLayer('front')}><ArrowUp size={15} weight="bold" /><span>Bring to front</span><kbd>⌥⌘]</kbd></button>
      <button type="button" role="menuitem" onClick={() => onLayer('forward')}><ArrowUp size={15} /><span>Bring forward</span><kbd>⌘]</kbd></button>
      <button type="button" role="menuitem" onClick={() => onLayer('backward')}><ArrowDown size={15} /><span>Send backward</span><kbd>⌘[</kbd></button>
      <button type="button" role="menuitem" onClick={() => onLayer('back')}><ArrowDown size={15} weight="bold" /><span>Send to back</span><kbd>⌥⌘[</kbd></button>
      <span className="layer-menu-divider" />
      <button type="button" role="menuitem" onClick={onDuplicate}><Copy size={15} /><span>Duplicate</span></button>
      <button type="button" role="menuitem" className="is-danger" onClick={onDelete}><Trash size={15} /><span>Delete</span></button>
    </div>
  )
}
