import type { AddElementInput, BoardEdge, BoardLayout, BoardNode, BoardSnapshot, ElementKind, GroupLayout, LayerAction } from '../types'

export function createId(prefix: string) {
  return `${prefix}-${createUUID()}`
}

export function createUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
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

export function arrangeNodes(nodes: BoardNode[], layout: BoardLayout): BoardNode[] {
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

  if (layout === 'stacked') {
    return [
      ...frames,
      ...movable.map((node, index) => ({
        ...node,
        position: { x: 170 + index * 30, y: 125 + index * 34 },
        zIndex: index + 1,
      })),
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

export function arrangeGroupNodes(nodes: BoardNode[], ids: string[], layout: GroupLayout): BoardNode[] {
  if (layout === 'none') return nodes
  const selected = nodes.filter((node) => ids.includes(node.id) && node.data.kind !== 'frame')
  if (!selected.length) throw new Error('Choose at least one valid non-frame element.')
  const originX = Math.min(...selected.map((node) => node.position.x))
  const originY = Math.min(...selected.map((node) => node.position.y))
  const clusterNames = [...new Set(selected.map((node) => node.data.cluster || 'Unsorted'))]
  return nodes.map((node) => {
    const index = selected.findIndex((candidate) => candidate.id === node.id)
    if (index < 0) return node
    if (layout === 'stacked') return { ...node, position: { x: originX + index * 26, y: originY + index * 30 }, zIndex: index + 1 }
    if (layout === 'columns') {
      const column = clusterNames.indexOf(node.data.cluster || 'Unsorted')
      const row = selected.filter((candidate) => (candidate.data.cluster || 'Unsorted') === (node.data.cluster || 'Unsorted')).findIndex((candidate) => candidate.id === node.id)
      return { ...node, position: { x: originX + column * 285, y: originY + row * 190 } }
    }
    const columns = Math.max(1, Math.ceil(Math.sqrt(selected.length)))
    return { ...node, position: { x: originX + (index % columns) * 285, y: originY + Math.floor(index / columns) * 190 } }
  })
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

export function moveNodeLayer(nodes: BoardNode[], id: string, action: LayerAction): BoardNode[] {
  const selected = nodes.find((node) => node.id === id)
  if (!selected) throw new Error(`Element ${id} was not found.`)
  const isFrame = selected.data.kind === 'frame'
  const ordered = nodes
    .filter((node) => (node.data.kind === 'frame') === isFrame)
    .map((node, index) => ({ node, index, layer: Number(node.zIndex ?? (node.data.kind === 'frame' ? 0 : 1)) }))
    .sort((a, b) => a.layer - b.layer || a.index - b.index)
    .map(({ node }) => node)
  const currentIndex = ordered.findIndex((node) => node.id === id)
  const [target] = ordered.splice(currentIndex, 1)
  const nextIndex = action === 'front'
    ? ordered.length
    : action === 'back'
      ? 0
      : action === 'forward'
        ? Math.min(ordered.length, currentIndex + 1)
        : Math.max(0, currentIndex - 1)
  ordered.splice(nextIndex, 0, target)
  const baseLayer = isFrame ? -ordered.length - 1 : 1
  const layers = new Map(ordered.map((node, index) => [node.id, baseLayer + index]))
  return nodes.map((node) => layers.has(node.id) ? { ...node, zIndex: layers.get(node.id) } : node)
}

export function createEmptyBoard(name = 'Untitled brainstorm'): BoardSnapshot {
  const now = new Date().toISOString()
  return { id: createUUID(), name, nodes: [], edges: [], createdAt: now, updatedAt: now }
}

export function serializeSnapshot(snapshot: BoardSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}
