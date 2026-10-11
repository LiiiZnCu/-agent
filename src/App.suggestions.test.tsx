// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { createBrainstormSession, createIdeaMeta } from './lib/brainstorm'
import { createBoardNode } from './lib/board'
import { saveBrainstormBoard } from './lib/brainstorm-storage'
import type { BoardSnapshot } from './types'

const time = '2026-10-10T00:00:00.000Z'
const reply = { message: '看看两种做法如何互补。', actions: [{ type: 'suggest_merge', ideaIds: ['idea-a', 'idea-b'], title: '合并方案', content: '保留两个想法', logic: '组合理由', risks: [], openQuestions: [] }] }
beforeEach(() => {
  cleanup(); localStorage.clear(); window.history.replaceState({}, '', '/')
  Object.defineProperty(document, 'modelContext', { configurable: true, value: undefined })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function setup(selected = false) {
  const session = createBrainstormSession({ id: 'discussion-ai', boardId: '12345678-1234-4234-8234-123456789abc', topic: '社区', goal: '共同决定', memberId: 'm', memberName: '林', createdAt: time })
  const board: BoardSnapshot = { id: session.boardId, brainstormSessionId: session.id, name: '社区', createdAt: time, updatedAt: time, edges: [], nodes: ['idea-a', 'idea-b'].map((id) => ({ ...createBoardNode({ title: id }), id, selected, data: { ...createBoardNode({ title: id }).data, ideaMeta: createIdeaMeta({ sessionId: session.id, authorId: 'm', type: 'idea', createdAt: time }) } })) }
  saveBrainstormBoard(board, session)
  render(<App />)
  return board
}
function backend(response: () => Promise<Response> = async () => new Response(JSON.stringify(reply))) {
  const requests: Array<{ purpose: string; ideaIds?: string[] }> = []
  vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
    if (url.endsWith('/suggestions')) { requests.push(JSON.parse(options!.body as string)); return response() }
    if (options?.method === 'PUT') { const data = JSON.parse(options.body as string); return new Response(JSON.stringify({ ok: true, sessionId: data.session.id, updatedAt: data.board.updatedAt })) }
    return new Response('{}')
  })
  return requests
}
function stored() { return JSON.parse(localStorage.getItem('canvas-relay-board-v2:12345678-1234-4234-8234-123456789abc')!) }

it('不自动求助，选择一组真实观点主动请求整合，待确认时白板不变', async () => {
  const requests = backend(); setup(true)
  expect(requests).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: '整合选中观点' }))
  await screen.findByText(reply.message)
  expect(requests).toEqual([{ purpose: '分析选中观点的互补关系并提出有来源的整合方案', ideaIds: ['idea-a', 'idea-b'] }])
  expect(screen.getByText('触发原因：互补观点')).toBeTruthy()
  await waitFor(() => expect(stored().brainstormSession.suggestions).toHaveLength(1))
  expect(stored().nodes).toHaveLength(2); expect(stored().brainstormSession.proposals).toEqual([])
  expect((screen.getByRole('button', { name: '需要帮助' }) as HTMLButtonElement).disabled).toBe(true)
})
it('无 Key 及网络错误明确显示，普通白板仍能添加观点', async () => {
  backend(async () => new Response(JSON.stringify({ error: '未配置 DEEPSEEK_API_KEY，无法请求 AI 建议。' }), { status: 503 })); setup()
  fireEvent.click(screen.getByRole('button', { name: '需要帮助' }))
  await screen.findByText(/未配置 DEEPSEEK_API_KEY/)
  fireEvent.click(screen.getByRole('button', { name: '添加观点' }))
  await waitFor(() => expect(stored().nodes).toHaveLength(3))
  backend(async () => { throw new Error('网络断开') })
  fireEvent.click(screen.getByRole('button', { name: '需要帮助' }))
  await screen.findByText(/网络断开/)
})
it('重复观点分析只由主动归类请求触发，传递选中 ID', async () => {
  const requests = backend(async () => new Response(JSON.stringify({ message: '真实分析', actions: [{ type: 'create_cluster', label: '归类', ideaIds: ['idea-a', 'idea-b'] }] }))); setup(true)
  fireEvent.click(screen.getByRole('button', { name: '智能归类选中观点' }))
  await screen.findByText('真实分析')
  expect(requests).toEqual([{ purpose: '分析选中观点是否重复或相似并提出分类建议', ideaIds: ['idea-a', 'idea-b'] }])
  expect(screen.getByText('触发原因：重复观点分析')).toBeTruthy()
})
it('编辑真实建议文本与方案信息后接受，撤销恢复原内容且后续人工历史可继续撤销', async () => {
  backend(); setup(true)
  fireEvent.click(screen.getByRole('button', { name: '整合选中观点' })); await screen.findByText(reply.message)
  fireEvent.click(screen.getByRole('button', { name: '编辑建议' }))
  fireEvent.change(screen.getByLabelText('建议说明'), { target: { value: '成员修改说明' } })
  fireEvent.change(screen.getByLabelText('方案标题'), { target: { value: '成员修订方案' } })
  fireEvent.change(screen.getByLabelText('组合逻辑'), { target: { value: '成员修订理由' } })
  fireEvent.click(screen.getByRole('button', { name: '保存建议' }))
  fireEvent.click(screen.getByRole('button', { name: '接受建议' }))
  await waitFor(() => expect(stored().brainstormSession.proposals[0]).toMatchObject({ title: '成员修订方案', sourceIdeaIds: ['idea-a', 'idea-b'], integrationLogic: '成员修订理由', status: 'draft' }))
  fireEvent.click(screen.getByRole('button', { name: '添加观点' }))
  fireEvent.click(screen.getByRole('button', { name: '撤销 AI 动作' }))
  await waitFor(() => { expect(stored().nodes).toHaveLength(3); expect(stored().brainstormSession.proposals).toEqual([]) })
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  await waitFor(() => expect(stored().nodes).toHaveLength(2))
  expect(stored().brainstormSession.proposals).toEqual([])
})
it('整组动作接受后普通撤销只撤销这一笔操作', async () => {
  backend(async () => new Response(JSON.stringify({ message: '分类并提问', actions: [{ type: 'create_cluster', label: '分类', ideaIds: ['idea-a', 'idea-b'] }, { type: 'ask_question', question: '谁负责？' }] }))); setup(true)
  fireEvent.click(screen.getByRole('button', { name: '需要帮助' })); await screen.findByText('分类并提问')
  fireEvent.click(screen.getByRole('button', { name: '接受建议' }))
  await waitFor(() => expect(stored().nodes).toHaveLength(4))
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  await waitFor(() => expect(stored().nodes).toHaveLength(2))
  expect(stored().nodes[0].data.cluster).toBeUndefined()
  expect(stored().brainstormSession.suggestions[0].status).toBe('pending')
})
it('忽略持久化，刷新后包含已忽略动作类型的回复不再显示', async () => {
  backend(); setup(true)
  fireEvent.click(screen.getByRole('button', { name: '整合选中观点' })); await screen.findByText(reply.message)
  fireEvent.click(screen.getByRole('button', { name: '忽略建议' }))
  await waitFor(() => expect(stored().brainstormSession.suggestions[0].status).toBe('ignored'))
  cleanup(); render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '需要帮助' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('已忽略'))
  expect(screen.queryByRole('button', { name: '接受建议' })).toBeNull()
})
it('本阶段暂停持久化，换阶段可求助，返回原阶段仍暂停', async () => {
  backend(); setup()
  fireEvent.click(screen.getByRole('checkbox', { name: '暂停 AI' }))
  await waitFor(() => expect(stored().brainstormSession.pausedStages).toEqual(['collecting']))
  fireEvent.click(screen.getByRole('button', { name: '智能归类' }))
  expect((screen.getByRole('button', { name: '需要帮助' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '想法收集' }))
  expect((screen.getByRole('button', { name: '需要帮助' }) as HTMLButtonElement).disabled).toBe(true)
})
it('稍后处理后只显示一项主要建议，恢复处理无需请求模型', async () => {
  const requests = backend(); setup(true)
  fireEvent.click(screen.getByRole('button', { name: '需要帮助' })); await screen.findByText(reply.message)
  fireEvent.click(screen.getByRole('button', { name: '稍后处理' }))
  expect(screen.queryByRole('button', { name: '接受建议' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '继续处理建议' }))
  expect(screen.getByRole('button', { name: '接受建议' })).toBeTruthy(); expect(requests).toHaveLength(1)
})
it('编辑内容无效时明确报错并保留编辑文本，修正后才能保存', async () => {
  backend(); setup(true)
  fireEvent.click(screen.getByRole('button', { name: '需要帮助' })); await screen.findByText(reply.message)
  fireEvent.click(screen.getByRole('button', { name: '编辑建议' }))
  fireEvent.change(screen.getByLabelText('方案标题'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '保存建议' }))
  expect(screen.getByRole('status').textContent).toContain('无效')
  expect((screen.getByLabelText('方案标题') as HTMLTextAreaElement).value).toBe('')
  fireEvent.change(screen.getByLabelText('方案标题'), { target: { value: '修正标题' } })
  fireEvent.click(screen.getByRole('button', { name: '保存建议' }))
  expect(screen.queryByLabelText('建议说明')).toBeNull()
  expect(screen.getByText('方案标题：修正标题')).toBeTruthy()
})
it('请求期间切板，拒绝旧回复', async () => {
  let finish!: (response: Response) => void
  const requests = backend(() => new Promise((resolve) => { finish = resolve })); setup(true)
  fireEvent.click(screen.getByRole('button', { name: '需要帮助' }))
  await waitFor(() => expect(requests).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: '新建空白白板' }))
  finish(new Response(JSON.stringify(reply)))
  await waitFor(() => expect(screen.queryByText(reply.message)).toBeNull())
  expect(stored().brainstormSession.suggestions).toEqual([])
})
it('请求期间新增观点，旧回复明确拒绝且人工观点保留', async () => {
  let finish!: (response: Response) => void
  const requests = backend(() => new Promise((resolve) => { finish = resolve })); setup(true)
  fireEvent.click(screen.getByRole('button', { name: '需要帮助' }))
  await waitFor(() => expect(requests).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: '添加观点' }))
  finish(new Response(JSON.stringify(reply)))
  await screen.findByText(/讨论已变化/)
  await waitFor(() => expect(stored().nodes).toHaveLength(3))
  expect(stored().brainstormSession.suggestions).toEqual([])
})
it('待确认后阶段变化，旧建议不能执行；内容变化也拒绝执行', async () => {
  backend(); setup(true)
  fireEvent.click(screen.getByRole('button', { name: '需要帮助' })); await screen.findByText(reply.message)
  fireEvent.click(screen.getByRole('button', { name: '智能归类' }))
  expect(screen.queryByRole('button', { name: '接受建议' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '想法收集' }))
  fireEvent.click(screen.getByRole('button', { name: '添加观点' }))
  fireEvent.click(screen.getByRole('button', { name: '接受建议' }))
  await screen.findByText(/讨论已变化/)
  await waitFor(() => expect(stored().nodes).toHaveLength(3))
  expect(stored().brainstormSession.proposals).toEqual([])
})
it('发布已接受建议的讨论时，全部快照改绑到新白板，仍可撤销', async () => {
  const hostedId = '23456789-1234-4234-8234-123456789abc'
  let hostedPayload: unknown
  vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
    const data = options?.body ? JSON.parse(options.body as string) : null
    if (url.endsWith('/suggestions')) return new Response(JSON.stringify(reply))
    if (url === '/api/murals') return new Response(JSON.stringify({ board: { ...data.board, id: hostedId }, revision: 1, ownerToken: 'owner', userToken: 'user', ownerUrl: 'http://localhost/#owner', userUrl: 'http://localhost/#access' }))
    if (url.startsWith('/api/murals/') && options?.method === 'PUT') return new Response(JSON.stringify({ ok: true, board: data.board, revision: 2 }))
    if (options?.method === 'PUT') { if (data.board.id === hostedId) hostedPayload = data; return new Response(JSON.stringify({ ok: true, sessionId: data.session.id, updatedAt: data.board.updatedAt })) }
    return new Response('{}')
  })
  setup(true)
  fireEvent.click(screen.getByRole('button', { name: '需要帮助' })); await screen.findByText(reply.message)
  fireEvent.click(screen.getByRole('button', { name: '接受建议' }))
  fireEvent.click(screen.getByRole('button', { name: '分享' }))
  fireEvent.click(screen.getByRole('button', { name: '发布并生成链接' }))
  await waitFor(() => expect((screen.getByRole('textbox', { name: '协作者链接' }) as HTMLInputElement).value).toContain('#access'))
  expect(hostedPayload).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '完成' }))
  fireEvent.click(screen.getByRole('button', { name: '撤销 AI 动作' }))
  await waitFor(() => {
    const board = JSON.parse(localStorage.getItem(`canvas-relay-board-v2:${hostedId}`)!)
    expect(board.nodes).toHaveLength(2); expect(board.brainstormSession.proposals).toEqual([])
  })
})
it('普通撤销重做保留 AI 操作身份，交错 AI 撤销后旧建议不能经历史复活', async () => {
  backend(); setup(true)
  fireEvent.click(screen.getByRole('button', { name: '需要帮助' })); await screen.findByText(reply.message)
  fireEvent.click(screen.getByRole('button', { name: '编辑建议' }))
  fireEvent.change(screen.getByLabelText('建议说明'), { target: { value: '编辑后的说明' } })
  fireEvent.click(screen.getByRole('button', { name: '保存建议' }))
  fireEvent.click(screen.getByRole('button', { name: '接受建议' }))
  fireEvent.click(screen.getByRole('button', { name: '添加观点' }))
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  expect(screen.getByRole('button', { name: '接受建议' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '重做' }))
  fireEvent.click(screen.getByRole('button', { name: '重做' }))
  fireEvent.click(screen.getByRole('button', { name: '撤销 AI 动作' }))
  await waitFor(() => { expect(stored().nodes).toHaveLength(3); expect(stored().brainstormSession.suggestions[0].status).toBe('undone') })
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  await waitFor(() => expect(stored().nodes).toHaveLength(2))
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  expect(screen.queryByRole('button', { name: '接受建议' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '重做' }))
  fireEvent.click(screen.getByRole('button', { name: '重做' }))
  expect(screen.queryByRole('button', { name: '接受建议' })).toBeNull()
  await waitFor(() => { expect(stored().nodes).toHaveLength(3); expect(stored().brainstormSession.proposals).toEqual([]) })
})
it('AI 接受被普通撤销再重做后，专项撤销会移除原操作历史', async () => {
  backend(); setup(true)
  fireEvent.click(screen.getByRole('button', { name: '需要帮助' })); await screen.findByText(reply.message)
  fireEvent.click(screen.getByRole('button', { name: '接受建议' }))
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  fireEvent.click(screen.getByRole('button', { name: '重做' }))
  fireEvent.click(screen.getByRole('button', { name: '添加观点' }))
  fireEvent.click(screen.getByRole('button', { name: '撤销 AI 动作' }))
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.queryByRole('button', { name: '接受建议' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '重做' }))
  fireEvent.click(screen.getByRole('button', { name: '重做' }))
  await waitFor(() => { expect(stored().nodes).toHaveLength(3); expect(stored().brainstormSession.proposals).toEqual([]) })
})
