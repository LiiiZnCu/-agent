import type { AddElementInput, BoardEdge, BoardNode, BoardSnapshot, ElementKind } from '../types'

let idSequence = 0

export function createId(prefix: string) {
  idSequence += 1
  return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}`
}

export function createBoardNode(input: AddElementInput, fallbackPosition = { x: 160, y: 140 }): BoardNode {
  const kind: ElementKind = input.kind ?? 'idea'
  const isFrame = kind === 'frame'

  return {
    id: createId(kind),
    type: 'boardElement',
    position: {
      x: Number.isFinite(input.x) ? Number(input.x) : fallbackPosition.x,
      y: Number.isFinite(input.y) ? Number(input.y) : fallbackPosition.y,
    },
    data: {
      title: input.title.trim().slice(0, 120) || 'Untitled',
      body: (input.body ?? '').trim().slice(0, 800),
      kind,
      color: input.color ?? (kind === 'question' ? 'rose' : kind === 'insight' ? 'mint' : 'sun'),
      votes: 0,
      cluster: input.cluster?.trim().slice(0, 80),
      justCreated: true,
    },
    style: isFrame ? { width: 620, height: 360 } : kind === 'artifact' ? { width: 520 } : { width: 228 },
    zIndex: isFrame ? -1 : 1,
  }
}

export function createBoardEdge(source: string, target: string, label?: string): BoardEdge {
  if (!source || !target) throw new Error('Both source and target element IDs are required.')
  if (source === target) throw new Error('An element cannot connect to itself.')

  return {
    id: createId('edge'),
    source,
    target,
    label: label?.trim().slice(0, 80),
    type: 'smoothstep',
    animated: false,
  }
}

export function arrangeNodes(nodes: BoardNode[], layout: 'grid' | 'columns' | 'radial'): BoardNode[] {
  const movable = nodes.filter((node) => node.data.kind !== 'frame')
  const frames = nodes.filter((node) => node.data.kind === 'frame')

  if (layout === 'radial') {
    const radius = Math.max(230, movable.length * 38)
    return [
      ...frames,
      ...movable.map((node, index) => {
        const angle = (index / Math.max(1, movable.length)) * Math.PI * 2 - Math.PI / 2
        return {
          ...node,
          position: {
            x: 430 + Math.cos(angle) * radius,
            y: 300 + Math.sin(angle) * radius,
          },
        }
      }),
    ]
  }

  const clusterNames = [...new Set(movable.map((node) => node.data.cluster || 'Unsorted'))]
  if (layout === 'columns') {
    return [
      ...frames,
      ...movable.map((node) => {
        const column = clusterNames.indexOf(node.data.cluster || 'Unsorted')
        const row = movable.filter(
          (candidate) => (candidate.data.cluster || 'Unsorted') === (node.data.cluster || 'Unsorted'),
        ).findIndex((candidate) => candidate.id === node.id)
        return { ...node, position: { x: 90 + column * 290, y: 110 + row * 190 } }
      }),
    ]
  }

  const columns = Math.max(2, Math.ceil(Math.sqrt(movable.length)))
  return [
    ...frames,
    ...movable.map((node, index) => ({
      ...node,
      position: { x: 100 + (index % columns) * 285, y: 110 + Math.floor(index / columns) * 195 },
    })),
  ]
}

export function calculateClusterBounds(nodes: BoardNode[], ids: string[]) {
  const members = nodes.filter((node) => ids.includes(node.id) && node.data.kind !== 'frame')
  if (!members.length) throw new Error('Choose at least one valid non-frame element.')
  const padding = 54
  const minX = Math.min(...members.map((node) => node.position.x))
  const minY = Math.min(...members.map((node) => node.position.y))
  const maxX = Math.max(...members.map((node) => node.position.x + Number(node.measured?.width ?? node.width ?? 228)))
  const maxY = Math.max(...members.map((node) => node.position.y + Number(node.measured?.height ?? node.height ?? 150)))
  return {
    x: minX - padding,
    y: minY - padding - 28,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2 + 28,
  }
}

export function serializeSnapshot(snapshot: BoardSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}
