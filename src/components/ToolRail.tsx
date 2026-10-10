import {
  CardsThree,
  CheckCircle,
  CursorClick,
  FrameCorners,
  Lightbulb,
  ListChecks,
  MagnifyingGlass,
  Plus,
  QuestionMark,
  Table,
  Warning,
  FileText,
} from '@phosphor-icons/react'
import type { MouseEvent } from 'react'
import type { ElementKind, IdeaType } from '../types'

type Props = {
  onAdd: (kind: ElementKind) => void
  onArtifact: (template: 'decision' | 'cards' | 'checklist') => void
  onIdea?: (type: IdeaType) => void
}

export function ToolRail({ onAdd, onArtifact, onIdea }: Props) {
  const chooseArtifact = (event: MouseEvent<HTMLButtonElement>, template: 'decision' | 'cards' | 'checklist') => {
    onArtifact(template)
    event.currentTarget.closest('details')?.removeAttribute('open')
  }

  return (
    <aside className="tool-rail" aria-label="Canvas tools">
      <button className="tool-button is-active" type="button" aria-label="Select and move" data-tooltip="Select">
        <CursorClick size={20} weight="bold" />
      </button>
      <span className="tool-divider" />
      {onIdea && <>
        <button className="tool-button" type="button" aria-label="Add risk" data-tooltip="风险" onClick={() => onIdea('risk')}><Warning size={20} weight="bold" /></button>
        <button className="tool-button" type="button" aria-label="Add evidence" data-tooltip="补充信息" onClick={() => onIdea('evidence')}><FileText size={20} weight="bold" /></button>
        <button className="tool-button" type="button" aria-label="Add proposal" data-tooltip="候选方案" onClick={() => onIdea('proposal')}><CardsThree size={20} weight="bold" /></button>
      </>}
      <button className="tool-button" type="button" aria-label="Add idea" data-tooltip="Idea" onClick={() => onAdd('idea')}>
        <Lightbulb size={20} weight="bold" />
      </button>
      <button className="tool-button" type="button" aria-label="Add question" data-tooltip="Question" onClick={() => onAdd('question')}>
        <QuestionMark size={20} weight="bold" />
      </button>
      <button className="tool-button" type="button" aria-label="Add insight" data-tooltip="Insight" onClick={() => onAdd('insight')}>
        <MagnifyingGlass size={20} weight="bold" />
      </button>
      <button className="tool-button" type="button" aria-label="Add action" data-tooltip="Action" onClick={() => onAdd('action')}>
        <CheckCircle size={20} weight="bold" />
      </button>
      <button className="tool-button" type="button" aria-label="Add frame" data-tooltip="Frame" onClick={() => onAdd('frame')}>
        <FrameCorners size={20} weight="bold" />
      </button>
      <span className="tool-divider" />
      <details className="artifact-menu">
        <summary className="tool-button" aria-label="Add structured artifact" data-tooltip="Artifacts">
          <Table size={20} weight="bold" />
          <Plus size={10} weight="bold" className="tool-plus" />
        </summary>
        <div className="artifact-menu-popover">
          <strong>Structured artifact</strong>
          <span>Reusable data with a readable spec.</span>
          <button type="button" onClick={(event) => chooseArtifact(event, 'decision')}><Table size={17} />Decision matrix</button>
          <button type="button" onClick={(event) => chooseArtifact(event, 'cards')}><CardsThree size={17} />Concept cards</button>
          <button type="button" onClick={(event) => chooseArtifact(event, 'checklist')}><ListChecks size={17} />Checklist</button>
        </div>
      </details>
    </aside>
  )
}
