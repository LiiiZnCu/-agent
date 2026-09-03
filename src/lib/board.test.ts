import { describe, expect, it } from 'vitest'
import type { BoardNode } from '../types'
import { arrangeNodes, calculateClusterBounds, createBoardEdge, createBoardNode, moveNodeLayer } from './board'

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

  it('creates a readable compact stack while leaving frames in place', () => {
    const frame = { ...createBoardNode({ title: 'Frame', kind: 'frame', x: 20, y: 30 }), id: 'frame' }
    const arranged = arrangeNodes([frame, node('a', 0, 0), node('b', 0, 0), node('c', 0, 0)], 'stacked')
    expect(arranged.find((item) => item.id === 'frame')?.position).toEqual({ x: 20, y: 30 })
    expect(arranged.find((item) => item.id === 'b')?.position.x).toBeGreaterThan(arranged.find((item) => item.id === 'a')!.position.x)
    expect(arranged.find((item) => item.id === 'c')?.zIndex).toBeGreaterThan(arranged.find((item) => item.id === 'a')!.zIndex!)
  })

  it('calculates a padded cluster frame around members', () => {
    const bounds = calculateClusterBounds([node('a', 100, 100), node('b', 400, 300)], ['a', 'b'])
    expect(bounds.x).toBeLessThan(100)
    expect(bounds.y).toBeLessThan(100)
    expect(bounds.width).toBeGreaterThan(500)
    expect(bounds.height).toBeGreaterThan(400)
  })

  it('moves selected elements through a normalized z stack', () => {
    const nodes = [node('a', 0, 0), node('b', 10, 10), node('c', 20, 20)].map((item, index) => ({ ...item, zIndex: index + 1 }))
    const front = moveNodeLayer(nodes, 'a', 'front')
    expect(front.find((item) => item.id === 'a')?.zIndex).toBe(3)
    const backward = moveNodeLayer(front, 'a', 'backward')
    expect(backward.find((item) => item.id === 'a')?.zIndex).toBe(2)
    expect(backward.map((item) => item.zIndex).sort()).toEqual([1, 2, 3])
  })

  it('keeps frames behind content when either stack is rearranged', () => {
    const frame = { ...createBoardNode({ title: 'Frame', kind: 'frame' }), id: 'frame', zIndex: -1 }
    const content = [node('a', 0, 0), node('b', 10, 10)]
    const contentBack = moveNodeLayer([frame, ...content], 'b', 'back')
    expect(contentBack.find((item) => item.id === 'b')?.zIndex).toBeGreaterThan(0)
    expect(contentBack.find((item) => item.id === 'frame')?.zIndex).toBeLessThan(0)
    const frameFront = moveNodeLayer(contentBack, 'frame', 'front')
    expect(frameFront.find((item) => item.id === 'frame')?.zIndex).toBeLessThan(0)
  })
})
