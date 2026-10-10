// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'

beforeEach(() => {
  cleanup()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })
})

describe('讨论入口', () => {
  it('首次打开时要求创建讨论，不展示演示白板', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: '创建讨论' })).toBeTruthy()
    expect(screen.queryByText('Walking stand-ups')).toBeNull()
  })

  it('成员填写任意主题后进入空白白板并可跳转阶段', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('主题'), { target: { value: '社区花园' } })
    fireEvent.change(screen.getByLabelText('目标'), { target: { value: '定出第一步' } })
    fireEvent.change(screen.getByLabelText('成员昵称'), { target: { value: '小林' } })
    fireEvent.click(screen.getByRole('button', { name: '开始讨论' }))
    const navigation = screen.getByRole('navigation', { name: '讨论阶段' })
    expect(within(navigation).getByText('社区花园')).toBeTruthy()
    expect(within(navigation).getByText('小林')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '成果输出' }))
    expect(screen.getByRole('button', { name: '成果输出' }).getAttribute('aria-current')).toBe('step')
  })
})
