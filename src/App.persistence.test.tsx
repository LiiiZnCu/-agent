// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { saveBrainstormBoard } from './lib/brainstorm-storage'
import type { BoardSnapshot, BrainstormSession } from './types'

const timestamp = '2026-10-10T10:00:00.000Z'
const board: BoardSnapshot = { id: '84571348-85fd-4d40-8b9e-fac16fac2ecf', brainstormSessionId: 'discussion-a', name: '测试白板', nodes: [], edges: [], createdAt: timestamp, updatedAt: timestamp }
const session: BrainstormSession = { id: 'discussion-a', boardId: board.id, topic: '测试主题', goal: '测试目标', background: '', constraints: '', stage: 'collecting', aiPaused: false, currentMemberId: 'member-a', members: [{ id: 'member-a', name: '测试成员', role: 'facilitator', joinedAt: timestamp }], suggestions: [], proposals: [], decision: null, outcome: null, createdAt: timestamp, updatedAt: timestamp }
type Pending = { board: BoardSnapshot; resolve: (response: Response) => void }
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/')
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

function rename(name: string) {
  fireEvent.change(screen.getByLabelText('Mural name'), { target: { value: name } })
  fireEvent.blur(screen.getByLabelText('Mural name'))
}
async function respond(pending: Pending, revision: number, name = pending.board.name) {
  await act(async () => pending.resolve(new Response(JSON.stringify({ ok: true, board: { ...pending.board, name }, revision }))))
}
async function hostedHarness() {
  const writes: Pending[] = []
  const discussions: BoardSnapshot[] = []
  saveBrainstormBoard(board, session)
  window.history.replaceState({}, '', `/?mural=${board.id}#owner=capability`)
  vi.stubGlobal('fetch', (url: string, options?: RequestInit) => {
    if (url.startsWith('/api/murals/') && options?.method === 'PUT') return new Promise<Response>((resolve) => writes.push({ board: JSON.parse(options.body as string).board, resolve }))
    if (url.startsWith('/api/murals/')) {
      return Promise.resolve(new Response(JSON.stringify({ board, brainstorm: session, revision: 1, role: 'owner', session: null, focusClaims: [] })))
    }
    if (url.startsWith('/api/brainstorm/')) {
      const payload = JSON.parse(options!.body as string)
      discussions.push(payload.board)
      return Promise.resolve(new Response(JSON.stringify({ ok: true, sessionId: payload.session.id, updatedAt: payload.board.updatedAt })))
    }
    return Promise.resolve(new Response('{}'))
  })
  render(<App />)
  await screen.findByText('Connected to hosted mural as owner')
  fireEvent.click(screen.getAllByRole('button', { name: 'Trace' })[0])
  return { writes, discussions }
}

it('新保存 B 确认后，旧托管回包 A 不能覆盖 B 或继续保存旧讨论', async () => {
  const { writes, discussions } = await hostedHarness()
  rename('编辑 A')
  await waitFor(() => expect(writes).toHaveLength(1))
  rename('编辑 B')
  await waitFor(() => expect(writes).toHaveLength(2))
  await respond(writes[1], 3, '确认 B')
  expect((screen.getByLabelText('Mural name') as HTMLInputElement).value).toBe('确认 B')
  await respond(writes[0], 2, '过期确认 A')
  expect((screen.getByLabelText('Mural name') as HTMLInputElement).value).toBe('确认 B')
  expect(discussions.map((snapshot) => snapshot.name)).toEqual(['确认 B'])
})

it('切换白板后，旧托管回包不能重新打开原白板', async () => {
  const { writes } = await hostedHarness()
  rename('编辑 A')
  await waitFor(() => expect(writes).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: 'New blank board' }))
  const nextId = localStorage.getItem('canvas-relay-current-board-v2')
  const nextName = (screen.getByLabelText('Mural name') as HTMLInputElement).value
  await respond(writes[0], 2, '过期托管白板')
  expect((screen.getByLabelText('Mural name') as HTMLInputElement).value).toBe(nextName)
  expect(new URLSearchParams(window.location.search).get('mural')).toBe(nextId)
})

it('新编辑尚未保存时，旧托管回执不能标记同步成功', async () => {
  const { writes } = await hostedHarness()
  rename('编辑 A')
  await waitFor(() => expect(writes).toHaveLength(1))
  rename('编辑 B')
  await waitFor(() => expect(writes).toHaveLength(2))
  await respond(writes[0], 2)
  expect((screen.getByLabelText('Mural name') as HTMLInputElement).value).toBe('编辑 B')
  expect(document.querySelector('.storage-status')?.textContent).toContain('Syncing SQLite')
})

it('本地讨论连续保存使用单调版本，旧回执不提前标记成功', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(timestamp))
  const writes: Array<Pending & { session: BrainstormSession }> = []
  saveBrainstormBoard(board, session)
  vi.stubGlobal('fetch', (url: string, options?: RequestInit) => {
    if (url.startsWith('/api/brainstorm/')) return new Promise<Response>((resolve) => writes.push({ ...JSON.parse(options!.body as string), resolve }))
    return Promise.resolve(new Response('{}'))
  })
  render(<App />)
  fireEvent.click(screen.getAllByRole('button', { name: 'Trace' })[0])
  await waitFor(() => expect(writes).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: '智能归类' }))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(Date.parse(writes[1].board.updatedAt)).toBeGreaterThan(Date.parse(writes[0].board.updatedAt))
  await act(async () => writes[0].resolve(new Response(JSON.stringify({ ok: true, sessionId: session.id, updatedAt: writes[0].board.updatedAt }))))
  expect(document.querySelector('.storage-status')?.textContent).toContain('Syncing SQLite')
  await act(async () => writes[1].resolve(new Response(JSON.stringify({ ok: true, sessionId: session.id, updatedAt: writes[1].board.updatedAt }))))
  expect(document.querySelector('.storage-status')?.textContent).toContain('Synced to local SQLite')
})
