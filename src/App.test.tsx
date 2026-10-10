// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import { createEmptyBoard } from './lib/board'
import { saveBoard } from './lib/storage'
import type { BoardSnapshot, BrainstormSession } from './types'

beforeEach(() => {
  cleanup()
  Object.defineProperty(document, 'modelContext', { configurable: true, value: undefined })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

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

  it('离线刷新后恢复讨论修改、阶段、暂停状态和观点作者', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    createDiscussion()
    fireEvent.click(screen.getByRole('button', { name: 'Add evidence' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '成员写的资料' } })
    fireEvent.click(screen.getByRole('button', { name: '协同优化' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '暂停 AI' }))
    await waitFor(() => expect(document.querySelector('.canvas-status')?.textContent).toContain('Saved locally'))
    cleanup()
    render(<App />)
    expect(within(screen.getByRole('navigation', { name: '讨论阶段' })).getByText('社区花园')).toBeTruthy()
    expect(screen.getByRole('button', { name: '协同优化' }).getAttribute('aria-current')).toBe('step')
    expect((screen.getByRole('checkbox', { name: '暂停 AI' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('成员写的资料')).toBeTruthy()
    const id = localStorage.getItem('canvas-relay-current-board-v2')
    const stored = JSON.parse(localStorage.getItem(`canvas-relay-board-v2:${id}`)!)
    expect(stored.nodes[0].data.ideaMeta.authorId).toBe(stored.brainstormSession.currentMemberId)
  })

  it('切换到空白白板清空讨论，切换回来恢复本板讨论和编辑', async () => {
    createDiscussion()
    const discussionBoardId = localStorage.getItem('canvas-relay-current-board-v2')!
    fireEvent.click(screen.getByRole('button', { name: '成果输出' }))
    fireEvent.click(screen.getByRole('button', { name: 'New blank board' }))
    expect(screen.queryByRole('navigation', { name: '讨论阶段' })).toBeNull()
    const original = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('社区花园') && button.closest('.board-library-menu'))
    expect(original).toBeTruthy()
    fireEvent.click(original!)
    expect(screen.getByRole('button', { name: '成果输出' }).getAttribute('aria-current')).toBe('step')
    expect(localStorage.getItem('canvas-relay-current-board-v2')).toBe(discussionBoardId)
  })

  it('发布讨论时保留讨论内容并将副本绑定到托管白板', async () => {
    const hostedId = '24aacdaa-53ec-4d20-b0ea-835dbb7c5f6c'
    let savedDiscussion: { board: BoardSnapshot; session: BrainstormSession } | null = null
    const writes: string[] = []
    let serverRevision = 1
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') writes.push(url)
      const data = options?.body ? JSON.parse(options.body as string) : null
      if (url === '/api/murals') return new Response(JSON.stringify({ board: { ...data.board, id: hostedId }, revision: 1, ownerToken: 'owner-token', userToken: 'user-token', ownerUrl: 'http://localhost/#owner', userUrl: 'http://localhost/#access' }))
      if (url.startsWith('/api/brainstorm/')) {
        savedDiscussion = data
        return new Response(JSON.stringify({ ok: true, sessionId: data.session.id, updatedAt: data.board.updatedAt }))
      }
      if (options?.method === 'PUT') return new Response(JSON.stringify({ ok: true, board: data.board, revision: ++serverRevision }))
      return new Response('{}')
    })
    createDiscussion()
    const originalId = localStorage.getItem('canvas-relay-current-board-v2')!
    fireEvent.click(screen.getByRole('button', { name: 'Add evidence' }))
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish and create link' }))
    await waitFor(() => expect((screen.getByLabelText('Collaborator URL') as HTMLInputElement).value).toContain('#access'))
    expect(within(screen.getByRole('navigation', { name: '讨论阶段' })).getByText('社区花园')).toBeTruthy()
    expect(savedDiscussion!.session.boardId).toBe(hostedId)
    expect(savedDiscussion!.board.nodes[0].data.ideaMeta!.sessionId).toBe(savedDiscussion!.session.id)
    const original = JSON.parse(localStorage.getItem(`canvas-relay-board-v2:${originalId}`)!)
    expect(savedDiscussion!.session.id).not.toBe(original.brainstormSession.id)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    writes.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Add risk' }))
    await waitFor(() => expect(savedDiscussion!.board.nodes).toHaveLength(2))
    expect(writes.findIndex((url) => url.startsWith('/api/murals/'))).toBeGreaterThanOrEqual(0)
    expect(writes.findIndex((url) => url.startsWith('/api/murals/'))).toBeLessThan(writes.findIndex((url) => url.startsWith('/api/brainstorm/')))
  })

  it('成员填写任意主题后进入空白白板并可跳转阶段', () => {
    createDiscussion()
    const navigation = screen.getByRole('navigation', { name: '讨论阶段' })
    expect(within(navigation).getByText('社区花园')).toBeTruthy()
    expect(within(navigation).getByText('小林')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '成果输出' }))
    expect(screen.getByRole('button', { name: '成果输出' }).getAttribute('aria-current')).toBe('step')
  })

  it('阶段支持前进、返回、重启和编辑主题，并保留已有观点', () => {
    createDiscussion()
    fireEvent.click(screen.getByRole('button', { name: 'Add idea' }))
    fireEvent.click(screen.getByRole('button', { name: '下一阶段' }))
    expect(screen.getByRole('button', { name: '智能归类' }).getAttribute('aria-current')).toBe('step')
    fireEvent.click(screen.getByRole('button', { name: '上一阶段' }))
    fireEvent.click(screen.getByRole('button', { name: '重启当前阶段' }))
    expect(screen.getByText('当前阶段已重启')).toBeTruthy()
    expect(document.querySelector('.canvas-status')?.textContent).toContain('1 elements')
    fireEvent.click(screen.getByRole('button', { name: '编辑讨论主题' }))
    fireEvent.change(screen.getByLabelText('讨论主题'), { target: { value: '新的主题' } })
    fireEvent.click(screen.getByRole('button', { name: '保存主题' }))
    expect(within(screen.getByRole('navigation', { name: '讨论阶段' })).getByText('新的主题')).toBeTruthy()
  })

  it('AI 建议初始为空，手动求助明确失败，暂停可由人切换', () => {
    createDiscussion()
    const panel = screen.getByRole('complementary', { name: '讨论与 AI' })
    expect(within(panel).getByText('暂无 AI 建议')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: '需要帮助' }))
    expect(within(panel).getByRole('status').textContent).toContain('AI 服务未连接')
    fireEvent.click(within(panel).getByRole('checkbox', { name: '暂停 AI' }))
    expect((within(panel).getByRole('checkbox', { name: '暂停 AI' }) as HTMLInputElement).checked).toBe(true)
    expect((within(panel).getByRole('button', { name: '需要帮助' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(panel).getByRole('checkbox', { name: '暂停 AI' }))
    expect((within(panel).getByRole('button', { name: '需要帮助' }) as HTMLButtonElement).disabled).toBe(false)
    expect(within(panel).getByText('暂无 AI 建议')).toBeTruthy()
  })

  it.each([['Add idea', '观点'], ['Add question', '问题'], ['Add risk', '风险'], ['Add evidence', '补充信息'], ['Add proposal', '候选方案']])('手动 %s 记录当前作者、类型、时间、来源和修改版本', async (button, type) => {
    createDiscussion()
    fireEvent.click(screen.getByRole('button', { name: button }))
    const inspector = await screen.findByRole('complementary', { name: 'Element inspector' })
    expect(within(inspector).getByText('小林')).toBeTruthy()
    expect(within(inspector).getByText(type)).toBeTruthy()
    expect(within(inspector).getByText('直接创建')).toBeTruthy()
    expect(within(inspector).getByText('版本 1')).toBeTruthy()
    expect(inspector.querySelector('time')?.getAttribute('dateTime')).toMatch(/^\d{4}-/)
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '成员自己的文字' } })
    fireEvent.blur(screen.getByLabelText('Title'))
    expect(within(inspector).getByText('版本 2')).toBeTruthy()
  })

  it.each(['Decision matrix', 'Concept cards', 'Checklist'])('手动创建 %s 没有预设记录', async (name) => {
    createDiscussion()
    fireEvent.click(screen.getByRole('button', { name }))
    const id = window.localStorage.getItem('canvas-relay-current-board-v2')
    await waitFor(() => {
      const board = JSON.parse(window.localStorage.getItem(`canvas-relay-board-v2:${id}`) || 'null')
      expect(board.nodes).toHaveLength(1)
      expect(board.nodes[0].data.artifact.records).toEqual([])
    })
  })

  function addProposal() {
    fireEvent.change(screen.getByLabelText('新方案标题'), { target: { value: '成员填写的方案' } })
    fireEvent.change(screen.getByLabelText('新方案说明'), { target: { value: '成员填写的做法' } })
    fireEvent.click(screen.getByRole('button', { name: '添加候选方案' }))
  }

  it('候选方案可编辑来源、组合逻辑、风险和待确认事项，五类评论全部保留', () => {
    createDiscussion()
    fireEvent.click(screen.getByRole('button', { name: 'Add idea' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '原始观点' } })
    addProposal()
    const proposal = screen.getByRole('region', { name: '方案：成员填写的方案' })
    fireEvent.change(within(proposal).getByLabelText('方案标题'), { target: { value: '修改后的方案' } })
    fireEvent.change(within(proposal).getByLabelText('组合逻辑'), { target: { value: '保留原始观点' } })
    fireEvent.change(within(proposal).getByLabelText('方案风险'), { target: { value: '资源不足' } })
    fireEvent.change(within(proposal).getByLabelText('待确认事项'), { target: { value: '确认场地' } })
    fireEvent.click(within(proposal).getByRole('checkbox', { name: '原始观点' }))
    for (const [kind, label] of [['support', '支持'], ['oppose', '反对'], ['supplement', '补充'], ['risk', '风险'], ['verify', '待验证']]) {
      fireEvent.change(within(proposal).getByLabelText('评论类型'), { target: { value: kind } })
      fireEvent.change(within(proposal).getByLabelText('评论内容'), { target: { value: `${label}的意见` } })
      fireEvent.click(within(proposal).getByRole('button', { name: '添加方案评论' }))
      expect(within(proposal).getByText(`${label}的意见`)).toBeTruthy()
    }
    expect(within(proposal).getByText('反对的意见')).toBeTruthy()
    expect(within(proposal).getByText('小林', { selector: '.proposal-author' })).toBeTruthy()
  })

  it('人工决策可编辑标准、评分理由和投票，并放入现有白板矩阵', async () => {
    createDiscussion()
    addProposal()
    fireEvent.click(screen.getByRole('button', { name: '辅助决策' }))
    fireEvent.change(screen.getByLabelText('新标准名称'), { target: { value: '可实现性' } })
    fireEvent.change(screen.getByLabelText('新标准权重'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '添加决策标准' }))
    fireEvent.change(screen.getByLabelText('标准名称'), { target: { value: '人力成本' } })
    fireEvent.change(screen.getByLabelText('标准权重'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('评分'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('评分理由'), { target: { value: '成员给出的理由' } })
    fireEvent.click(screen.getByRole('button', { name: '保存评分' }))
    expect(screen.getByText('成员给出的理由', { selector: 'p' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '投票支持此方案' }))
    expect(screen.getByText('票数：1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '撤回我的投票' }))
    expect(screen.getByText('票数：0')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '放入白板矩阵' }))
    const id = window.localStorage.getItem('canvas-relay-current-board-v2')
    await waitFor(() => {
      const board = JSON.parse(window.localStorage.getItem(`canvas-relay-board-v2:${id}`) || 'null')
      const matrix = board.nodes.find((node: { data: { artifact?: { artifactType: string } } }) => node.data.artifact?.artifactType === 'matrix').data.artifact
      expect(matrix.records[0]).toMatchObject({ proposal: '成员填写的方案', criterion: '人力成本', score: 7, reason: '成员给出的理由', weight: 3 })
    })
  })

  it('成果草稿和最终方案经成员确认才能导出，继续修改会取消确认', () => {
    createDiscussion()
    addProposal()
    fireEvent.click(screen.getByRole('button', { name: '接受方案' }))
    fireEvent.click(screen.getByRole('button', { name: '成果输出' }))
    const exportButton = screen.getByRole('button', { name: '导出讨论成果' }) as HTMLButtonElement
    expect(exportButton.disabled).toBe(true)
    expect((screen.getByLabelText('成果草稿') as HTMLTextAreaElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('成果草稿'), { target: { value: '成员确认的结果与理由' } })
    fireEvent.change(screen.getByLabelText('最终方案'), { target: { value: (screen.getByLabelText('最终方案') as HTMLSelectElement).options[1].value } })
    fireEvent.click(screen.getByRole('button', { name: '确认最终结果' }))
    expect(exportButton.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('成果草稿'), { target: { value: '修改后的结果' } })
    expect(exportButton.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '确认最终结果' }))
    expect(exportButton.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('方案说明'), { target: { value: '改变实施步骤' } })
    expect(exportButton.disabled).toBe(true)
  })

  it.each(['添加', '复制'])('%s候选方案作为同一笔历史修改取消确认，撤销后恢复确认', (operation) => {
    createDiscussion()
    addProposal()
    fireEvent.click(screen.getByRole('button', { name: '接受方案' }))
    fireEvent.click(screen.getByRole('button', { name: '成果输出' }))
    fireEvent.change(screen.getByLabelText('成果草稿'), { target: { value: '确认内容' } })
    const finalSelect = screen.getByLabelText('最终方案') as HTMLSelectElement
    fireEvent.change(finalSelect, { target: { value: finalSelect.options[1].value } })
    fireEvent.click(screen.getByRole('button', { name: '确认最终结果' }))
    if (operation === '添加') addProposal()
    else fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect((screen.getByRole('button', { name: '导出讨论成果' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect((screen.getByRole('button', { name: '导出讨论成果' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getAllByRole('region', { name: /方案：/ })).toHaveLength(1)
  })

  it('工具栏方案与检查器保持同一份方案，修改原始观点会取消成果确认', () => {
    createDiscussion()
    fireEvent.click(screen.getByRole('button', { name: 'Add proposal' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '从白板创建的方案' } })
    expect((screen.getByLabelText('方案标题') as HTMLInputElement).value).toBe('从白板创建的方案')
    fireEvent.click(screen.getByRole('button', { name: '接受方案' }))
    fireEvent.click(screen.getByRole('button', { name: '成果输出' }))
    fireEvent.change(screen.getByLabelText('成果草稿'), { target: { value: '完成结果' } })
    const finalSelect = screen.getByLabelText('最终方案') as HTMLSelectElement
    fireEvent.change(finalSelect, { target: { value: finalSelect.options[1].value } })
    fireEvent.click(screen.getByRole('button', { name: '确认最终结果' }))
    expect((screen.getByRole('button', { name: '导出讨论成果' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: '修改白板方案内容' } })
    expect((screen.getByLabelText('方案说明') as HTMLTextAreaElement).value).toBe('修改白板方案内容')
    expect((screen.getByRole('button', { name: '导出讨论成果' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('成员加入和切换后新观点使用当前成员身份，复制观点保留来源而不冒用原作者', () => {
    createDiscussion()
    fireEvent.click(screen.getByRole('button', { name: 'Add idea' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '第一位成员的观点' } })
    fireEvent.change(screen.getByLabelText('新成员昵称'), { target: { value: '小夏' } })
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
    const member = screen.getByLabelText('当前成员') as HTMLSelectElement
    fireEvent.change(member, { target: { value: member.options[1].value } })
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    const inspector = screen.getByRole('complementary', { name: 'Element inspector' })
    expect(within(inspector).getByText('小夏')).toBeTruthy()
    expect(within(inspector).getByText('版本 1')).toBeTruthy()
    expect(within(inspector).queryByText('直接创建')).toBeNull()
  })

  it('删除方案卡会清理对应决策并取消成果确认', () => {
    createDiscussion()
    addProposal()
    fireEvent.click(screen.getByRole('button', { name: '接受方案' }))
    fireEvent.click(screen.getByRole('button', { name: '成果输出' }))
    fireEvent.change(screen.getByLabelText('成果草稿'), { target: { value: '确认内容' } })
    const finalSelect = screen.getByLabelText('最终方案') as HTMLSelectElement
    fireEvent.change(finalSelect, { target: { value: finalSelect.options[1].value } })
    fireEvent.click(screen.getByRole('button', { name: '确认最终结果' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect((screen.getByRole('button', { name: '导出讨论成果' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('最终方案') as HTMLSelectElement).options).toHaveLength(1)
  })

  it('白板撤销和重做同步还原方案编辑与删除', () => {
    createDiscussion()
    addProposal()
    fireEvent.change(screen.getByLabelText('方案标题'), { target: { value: '修改后的标题' } })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect((screen.getByLabelText('方案标题') as HTMLInputElement).value).toBe('成员填写的方案')
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect((screen.getByLabelText('方案标题') as HTMLInputElement).value).toBe('修改后的标题')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.queryByLabelText('方案标题')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect((screen.getByLabelText('方案标题') as HTMLInputElement).value).toBe('修改后的标题')
  })

  it('侧栏编辑方案内容同样记录白板版本', () => {
    createDiscussion()
    addProposal()
    const inspector = screen.getByRole('complementary', { name: 'Element inspector' })
    expect(within(inspector).getByText('版本 1')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('方案说明'), { target: { value: '修改了做法' } })
    expect(within(inspector).getByText('版本 2')).toBeTruthy()
  })

  it('切换讨论阶段不会注销已有的白板协作工具', () => {
    let registrationSignal: AbortSignal | undefined
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      registerTool: (_tool: unknown, options?: { signal?: AbortSignal }) => { registrationSignal = options?.signal },
    } })
    createDiscussion()
    const activeSignal = registrationSignal!
    expect(activeSignal.aborted).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '下一阶段' }))
    expect(activeSignal.aborted).toBe(false)
  })

  it('画布与讨论交错修改时按同一历史顺序撤销和重做，新修改清空重做', () => {
    createDiscussion()
    fireEvent.click(screen.getByRole('button', { name: 'Add idea' }))
    fireEvent.click(screen.getByRole('button', { name: '下一阶段' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '后来画布编辑' } })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: '智能归类' }).getAttribute('aria-current')).toBe('step')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: '想法收集' }).getAttribute('aria-current')).toBe('step')
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getByRole('button', { name: '智能归类' }).getAttribute('aria-current')).toBe('step')
    fireEvent.click(screen.getByRole('button', { name: '成果输出' }))
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: '智能归类' }).getAttribute('aria-current')).toBe('step')
  })

  it('成员、评分理由、草稿和确认操作都能单独撤销', () => {
    createDiscussion()
    addProposal()
    fireEvent.change(screen.getByLabelText('新成员昵称'), { target: { value: '小夏' } })
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect((screen.getByLabelText('当前成员') as HTMLSelectElement).options).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '接受方案' }))
    fireEvent.click(screen.getByRole('button', { name: '辅助决策' }))
    fireEvent.change(screen.getByLabelText('新标准名称'), { target: { value: '成本' } })
    fireEvent.change(screen.getByLabelText('新标准权重'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '添加决策标准' }))
    fireEvent.change(screen.getByLabelText('评分'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('评分理由'), { target: { value: '当前理由' } })
    fireEvent.click(screen.getByRole('button', { name: '保存评分' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByText('当前理由', { selector: 'p' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '成果输出' }))
    fireEvent.change(screen.getByLabelText('成果草稿'), { target: { value: '新草稿' } })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect((screen.getByLabelText('成果草稿') as HTMLTextAreaElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('成果草稿'), { target: { value: '待确认草稿' } })
    const finalSelect = screen.getByLabelText('最终方案') as HTMLSelectElement
    fireEvent.change(finalSelect, { target: { value: finalSelect.options[1].value } })
    fireEvent.click(screen.getByRole('button', { name: '确认最终结果' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect((screen.getByRole('button', { name: '导出讨论成果' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each([['JSON', 'json'], ['MD', 'md'], ['CSV', 'csv']])('Trace %s 导出必须等成果确认，普通白板导出仍可用', (format, extension) => {
    const downloads: string[] = []
    vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:test' } static revokeObjectURL() {} })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { downloads.push(this.download) })
    createDiscussion()
    addProposal()
    fireEvent.click(screen.getByRole('button', { name: '接受方案' }))
    fireEvent.click(screen.getByRole('button', { name: 'Trace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Record session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish session' }))
    const traceButton = screen.getByRole('button', { name: format }) as HTMLButtonElement
    expect(traceButton.disabled).toBe(true)
    expect(screen.getByText('请先确认讨论成果，再导出讨论记录。')).toBeTruthy()
    fireEvent.click(traceButton)
    expect(downloads).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(downloads).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '成果输出' }))
    fireEvent.change(screen.getByLabelText('成果草稿'), { target: { value: '确认的成果' } })
    const finalSelect = screen.getByLabelText('最终方案') as HTMLSelectElement
    fireEvent.change(finalSelect, { target: { value: finalSelect.options[1].value } })
    fireEvent.click(screen.getByRole('button', { name: '确认最终结果' }))
    expect(traceButton.disabled).toBe(false)
    fireEvent.click(traceButton)
    expect(downloads).toHaveLength(2)
    expect(downloads[1].endsWith(`.${extension}`)).toBe(true)
  })

  it('复制方案同步创建可评论、评分并选择为最终结果的方案副本', () => {
    createDiscussion()
    addProposal()
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    const copy = screen.getByRole('region', { name: '方案：成员填写的方案 copy' })
    fireEvent.change(within(copy).getByLabelText('评论内容'), { target: { value: '副本的新评论' } })
    fireEvent.click(within(copy).getByRole('button', { name: '添加方案评论' }))
    expect(within(copy).getByText('副本的新评论')).toBeTruthy()
    fireEvent.click(within(copy).getByRole('button', { name: '接受方案' }))
    fireEvent.click(screen.getByRole('button', { name: '辅助决策' }))
    fireEvent.change(screen.getByLabelText('新标准名称'), { target: { value: '可行性' } })
    fireEvent.change(screen.getByLabelText('新标准权重'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '添加决策标准' }))
    fireEvent.change(screen.getAllByLabelText('评分')[1], { target: { value: '6' } })
    fireEvent.change(screen.getAllByLabelText('评分理由')[1], { target: { value: '副本评分理由' } })
    fireEvent.click(screen.getAllByRole('button', { name: '保存评分' })[1])
    expect(screen.getByText('副本评分理由', { selector: 'p' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '成果输出' }))
    const final = screen.getByLabelText('最终方案') as HTMLSelectElement
    expect(final.options[1].textContent).toBe('成员填写的方案 copy')
    fireEvent.change(final, { target: { value: final.options[1].value } })
    fireEvent.change(screen.getByLabelText('成果草稿'), { target: { value: '采用副本的成果' } })
    fireEvent.click(screen.getByRole('button', { name: '确认最终结果' }))
    expect((screen.getByRole('button', { name: '导出讨论成果' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('双击画布创建空白观点', async () => {
    createDiscussion()
    fireEvent.doubleClick(document.querySelector('.react-flow__pane')!, { clientX: 500, clientY: 250 })
    const id = window.localStorage.getItem('canvas-relay-current-board-v2')
    await waitFor(() => {
      const board = JSON.parse(window.localStorage.getItem(`canvas-relay-board-v2:${id}`) || 'null')
      expect(board.nodes).toHaveLength(1)
      expect(board.nodes[0].data.title).toBe('')
      expect(board.nodes[0].data.body).toBe('')
    })
  })

  it('方案组合逻辑、风险、待确认事项及来源每次实际变化均记录版本', () => {
    createDiscussion()
    fireEvent.click(screen.getByRole('button', { name: 'Add idea' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '来源观点' } })
    addProposal()
    const inspector = screen.getByRole('complementary', { name: 'Element inspector' })
    expect(within(inspector).getByText('版本 1')).toBeTruthy()
    for (const [index, label] of ['组合逻辑', '方案风险', '待确认事项'].entries()) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: `${label}内容` } })
      expect(within(inspector).getByText(`版本 ${index + 2}`)).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('checkbox', { name: '来源观点' }))
    expect(within(inspector).getByText('版本 5')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('组合逻辑'), { target: { value: '组合逻辑内容' } })
    expect(within(inspector).getByText('版本 5')).toBeTruthy()
  })

  it('仅聚焦和离开检查器字段不增加版本，实际输入只记录一次', () => {
    createDiscussion()
    fireEvent.click(screen.getByRole('button', { name: 'Add idea' }))
    const inspector = screen.getByRole('complementary', { name: 'Element inspector' })
    fireEvent.focus(screen.getByLabelText('Title'))
    fireEvent.blur(screen.getByLabelText('Title'))
    expect(within(inspector).getByText('版本 1')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '真实修改' } })
    fireEvent.blur(screen.getByLabelText('Title'))
    expect(within(inspector).getByText('版本 2')).toBeTruthy()
    fireEvent.blur(screen.getByLabelText('Title'))
    expect(within(inspector).getByText('版本 2')).toBeTruthy()
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
