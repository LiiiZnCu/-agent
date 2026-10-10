// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import { createEmptyBoard } from './lib/board'
import { saveBoard } from './lib/storage'

beforeEach(() => {
  cleanup()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })
})

describe('讨论入口', () => {
  function createDiscussion() {
    render(<App />)
    fireEvent.change(screen.getByLabelText('主题'), { target: { value: '社区花园' } })
    fireEvent.change(screen.getByLabelText('目标'), { target: { value: '定出第一步' } })
    fireEvent.change(screen.getByLabelText('成员昵称'), { target: { value: '小林' } })
    fireEvent.click(screen.getByRole('button', { name: '开始讨论' }))
  }

  it('首次打开时要求创建讨论，不展示演示白板', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: '创建讨论' })).toBeTruthy()
    expect(screen.queryByText('Walking stand-ups')).toBeNull()
  })

  it('成员填写任意主题后进入空白白板并可跳转阶段', () => {
    createDiscussion()
    const navigation = screen.getByRole('navigation', { name: '讨论阶段' })
    expect(within(navigation).getByText('社区花园')).toBeTruthy()
    expect(within(navigation).getByText('小林')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '成果输出' }))
    expect(screen.getByRole('button', { name: '成果输出' }).getAttribute('aria-current')).toBe('step')
  })

  it('真实创建的白板没有节点、连线或演示入口，记录功能仍可使用', () => {
    createDiscussion()
    const boardId = window.localStorage.getItem('canvas-relay-current-board-v2')
    const board = JSON.parse(window.localStorage.getItem(`canvas-relay-board-v2:${boardId}`) || 'null')
    expect(board.nodes).toEqual([])
    expect(board.edges).toEqual([])
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Collaboration views' })).getByRole('button', { name: 'Agent' }))
    expect(screen.queryByRole('button', { name: /Generate six ideas/ })).toBeNull()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Collaboration views' })).getByRole('button', { name: 'Trace' }))
    expect(screen.queryByRole('button', { name: 'Load agent demo' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Record session' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Record session' }))
    expect(screen.getByRole('button', { name: 'Finish session' })).toBeTruthy()
  })

  it('新建不同白板时清理旧讨论状态', () => {
    createDiscussion()
    fireEvent.click(screen.getByRole('button', { name: 'Create a new mural' }))
    expect(screen.queryByRole('navigation', { name: '讨论阶段' })).toBeNull()
  })

  it('切换到另一个白板时清理旧讨论状态', () => {
    render(<App />)
    const other = createEmptyBoard('其他白板')
    saveBoard(other)
    fireEvent.change(screen.getByLabelText('主题'), { target: { value: '社区花园' } })
    fireEvent.change(screen.getByLabelText('目标'), { target: { value: '定出第一步' } })
    fireEvent.change(screen.getByLabelText('成员昵称'), { target: { value: '小林' } })
    fireEvent.click(screen.getByRole('button', { name: '开始讨论' }))
    fireEvent.click(screen.getByRole('button', { name: /其他白板0 elements/ }))
    expect(screen.queryByRole('navigation', { name: '讨论阶段' })).toBeNull()
  })

  it('导入另一个白板时清理旧讨论状态', async () => {
    createDiscussion()
    const file = new File([JSON.stringify(createEmptyBoard('导入白板'))], 'board.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(createEmptyBoard('导入白板')) })
    fireEvent.change(screen.getByLabelText('Import mural JSON'), { target: { files: [file] } })
    await waitFor(() => expect(screen.queryByRole('navigation', { name: '讨论阶段' })).toBeNull())
  })
})
