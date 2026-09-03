import { describe, expect, it } from 'vitest'
import type { BoardNode } from '../types'
import { arrangeNodes, calculateClusterBounds, createBoardEdge, createBoardNode } from './board'

function node(id: string, x: number, y: number, cluster?: string): BoardNode {
  return {
    ...createBoardNode({ title: id, kind: 'idea', x, y, cluster }),
    id,
    data: { ...createBoardNode({ title: id }).data, title: id, cluster },
  }
}

describe('board primitives', () => {
  it('creates safe visual elements with bounded content', () => {
    const created = createBoardNode({ title: `  ${'A'.repeat(140)}  `, body: '  Detail  ', kind: 'question' })
    expect(created.data.title).toHaveLength(120)
    expect(created.data.body).toBe('Detail')
    expect(created.data.color).toBe('rose')
  })

  it('rejects self-referencing connections', () => {
    expect(() => createBoardEdge('same', 'same')).toThrow('cannot connect to itself')
  })

  it('arranges elements by semantic cluster in columns', () => {
    const arranged = arrangeNodes([
      node('a', 0, 0, 'People'),
      node('b', 0, 0, 'Product'),
      node('c', 0, 0, 'People'),
    ], 'columns')
    expect(arranged.find((item) => item.id === 'a')?.position.x).toBe(arranged.find((item) => item.id === 'c')?.position.x)
    expect(arranged.find((item) => item.id === 'b')?.position.x).not.toBe(arranged.find((item) => item.id === 'a')?.position.x)
  })

  it('calculates a padded cluster frame around members', () => {
    const bounds = calculateClusterBounds([node('a', 100, 100), node('b', 400, 300)], ['a', 'b'])
    expect(bounds.x).toBeLessThan(100)
    expect(bounds.y).toBeLessThan(100)
    expect(bounds.width).toBeGreaterThan(500)
    expect(bounds.height).toBeGreaterThan(400)
  })
})
