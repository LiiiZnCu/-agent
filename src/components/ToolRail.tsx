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
    <aside className="tool-rail" aria-label="画布工具">
      <button className="tool-button is-active" type="button" aria-label="选择并移动" data-tooltip="选择">
        <CursorClick size={20} weight="bold" />
      </button>
      <span className="tool-divider" />
      {onIdea && <>
        <button className="tool-button" type="button" aria-label="添加风险" data-tooltip="风险" onClick={() => onIdea('risk')}><Warning size={20} weight="bold" /></button>
        <button className="tool-button" type="button" aria-label="添加补充信息" data-tooltip="补充信息" onClick={() => onIdea('evidence')}><FileText size={20} weight="bold" /></button>
        <button className="tool-button" type="button" aria-label="添加候选方案" data-tooltip="候选方案" onClick={() => onIdea('proposal')}><CardsThree size={20} weight="bold" /></button>
      </>}
      <button className="tool-button" type="button" aria-label="添加观点" data-tooltip="观点" onClick={() => onAdd('idea')}>
        <Lightbulb size={20} weight="bold" />
      </button>
      <button className="tool-button" type="button" aria-label="添加问题" data-tooltip="问题" onClick={() => onAdd('question')}>
        <QuestionMark size={20} weight="bold" />
      </button>
      <button className="tool-button" type="button" aria-label="添加洞察" data-tooltip="洞察" onClick={() => onAdd('insight')}>
        <MagnifyingGlass size={20} weight="bold" />
      </button>
      <button className="tool-button" type="button" aria-label="添加行动" data-tooltip="行动" onClick={() => onAdd('action')}>
        <CheckCircle size={20} weight="bold" />
      </button>
      <button className="tool-button" type="button" aria-label="添加分类框" data-tooltip="分类框" onClick={() => onAdd('frame')}>
        <FrameCorners size={20} weight="bold" />
      </button>
      <span className="tool-divider" />
      <details className="artifact-menu">
        <summary className="tool-button" aria-label="添加结构化成果" data-tooltip="结构化成果">
          <Table size={20} weight="bold" />
          <Plus size={10} weight="bold" className="tool-plus" />
        </summary>
        <div className="artifact-menu-popover">
          <strong>结构化成果</strong>
          <span>可复用的数据，附有清晰的结构说明。</span>
          <button type="button" onClick={(event) => chooseArtifact(event, 'decision')}><Table size={17} />决策矩阵</button>
          <button type="button" onClick={(event) => chooseArtifact(event, 'cards')}><CardsThree size={17} />概念卡片</button>
          <button type="button" onClick={(event) => chooseArtifact(event, 'checklist')}><ListChecks size={17} />检查清单</button>
        </div>
      </details>
    </aside>
  )
}
