import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardSnapshot, BrainstormSession } from '../src/types'

const timestamp = '2026-10-10T10:00:00.000Z'
const session: BrainstormSession = {
  id: 'discussion-a', boardId: 'board-a', topic: '改善社区活动', goal: '形成可执行方案', background: '社区成员共同讨论', constraints: '预算有限',
  stage: 'organizing', aiPaused: false, currentMemberId: 'member-a',
  members: [{ id: 'member-a', name: '小林', role: 'facilitator', joinedAt: timestamp }],
  proposals: [], suggestions: [], decision: null, outcome: null, createdAt: timestamp, updatedAt: timestamp,
}
const board: BoardSnapshot = {
  id: 'board-a', brainstormSessionId: session.id, name: '社区活动', edges: [], createdAt: timestamp, updatedAt: timestamp,
  nodes: ['idea-a', 'idea-b'].map((id) => ({
    id, type: 'boardElement', position: { x: 0, y: 0 },
    data: { title: id === 'idea-a' ? '开展读书会' : '组织志愿活动', body: '成员提出的真实内容', kind: 'idea', color: 'paper', votes: 0,
      ideaMeta: { sessionId: session.id, authorId: 'member-a', type: 'idea', createdAt: timestamp, sourceIdeaIds: [], versions: [] } },
  })),
}
const actions = [
  { type: 'create_cluster', label: '社区参与', ideaIds: ['idea-a', 'idea-b'] },
  { type: 'connect_ideas', fromId: 'idea-a', toId: 'idea-b', label: '互补' },
  { type: 'ask_question', question: '怎样安排活动时间？' },
  { type: 'suggest_merge', ideaIds: ['idea-a', 'idea-b'], title: '社区学习与服务', content: '结合读书与志愿活动', logic: '让学习成果用于社区服务', risks: ['时间协调'], openQuestions: ['谁负责组织？'] },
  { type: 'create_matrix', title: '比较方案', criteria: ['成本', '参与人数'] },
  { type: 'create_summary', summary: '讨论包含学习和社区服务两条思路。' },
]
const validResponse = { message: '这些观点可以进一步整理。', actions }

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('模型建议严格校验', () => {
  it('接受六种完整动作且不会改写输入', async () => {
    const { validateAgentResponse } = await import('./agent-actions')
    const original = structuredClone({ board, session, validResponse })
    const result = validateAgentResponse(validResponse, board, session)
    expect(result).toEqual(validResponse)
    expect(result).not.toBe(validResponse)
    expect({ board, session, validResponse }).toEqual(original)
  })

  it.each([
    null, {}, { message: '', actions }, { message: '   ', actions }, { message: '说明' },
    { actions }, { message: '说明', actions: [] }, { message: '说明', actions: '执行' },
    { ...validResponse, execute: true },
  ])('拒绝缺失、空或额外的建议字段：%j', async (value) => {
    const { validateAgentResponse } = await import('./agent-actions')
    expect(() => validateAgentResponse(value, board, session)).toThrow()
  })

  it.each([
    { type: 'delete_ideas', ideaIds: ['idea-a'] },
    { type: 'create_cluster', ideaIds: ['idea-a'] },
    { type: 'create_cluster', label: '分类', ideaIds: [] },
    { type: 'create_cluster', label: '分类', ideaIds: ['idea-a', 'idea-a'] },
    { type: 'create_cluster', label: '分类', ideaIds: ['missing'] },
    { type: 'connect_ideas', fromId: 'idea-a', toId: 'idea-a', label: '关系' },
    { type: 'connect_ideas', fromId: 'idea-a', toId: 'missing', label: '关系' },
    { type: 'ask_question' },
    { type: 'ask_question', question: '问题', execute: true },
    { ...actions[3], ideaIds: ['idea-a'] },
    { ...actions[3], logic: undefined },
    { ...actions[3], risks: '风险' },
    { ...actions[3], openQuestions: undefined },
    { type: 'create_matrix', title: '比较', criteria: [] },
    { type: 'create_matrix', title: '比较', criteria: [''] },
    { type: 'create_summary' },
  ])('拒绝未知动作、错误字段或观点引用：%j', async (action) => {
    const { validateAgentResponse } = await import('./agent-actions')
    expect(() => validateAgentResponse({ message: '建议', actions: [action] }, board, session)).toThrow()
  })

  it('拒绝白板里属于其他讨论的观点', async () => {
    const { validateAgentResponse } = await import('./agent-actions')
    const foreignBoard = structuredClone(board)
    foreignBoard.nodes[0].data.ideaMeta!.sessionId = 'another-discussion'
    expect(() => validateAgentResponse(validResponse, foreignBoard, session)).toThrow()
  })

  it('拒绝不属于当前讨论的白板', async () => {
    const { validateAgentResponse } = await import('./agent-actions')
    expect(() => validateAgentResponse(validResponse, { ...board, id: 'another-board' }, session)).toThrow()
    expect(() => validateAgentResponse(validResponse, { ...board, brainstormSessionId: 'another-discussion' }, session)).toThrow()
  })
})

describe('建议请求意图校验', () => {
  it('保留操作目的及明确选择的真实观点', async () => {
    const { validateSuggestionRequest } = await import('./agent-actions')
    expect(validateSuggestionRequest({ purpose: '整合这些观点', ideaIds: ['idea-a', 'idea-b'] }, board, session)).toEqual({ purpose: '整合这些观点', ideaIds: ['idea-a', 'idea-b'] })
    expect(validateSuggestionRequest({ purpose: '引导讨论' }, board, session)).toEqual({ purpose: '引导讨论' })
  })

  it.each([null, {}, { purpose: '' }, { purpose: ' ' }, { purpose: 1 }, { purpose: '整理', execute: true },
    { purpose: '整理', ideaIds: [] }, { purpose: '整理', ideaIds: 'idea-a' }, { purpose: '整理', ideaIds: ['missing'] },
    { purpose: '整理', ideaIds: ['idea-a', 'idea-a'] }])('拒绝不完整目的和无效选中观点：%j', async (value) => {
    const { validateSuggestionRequest } = await import('./agent-actions')
    expect(() => validateSuggestionRequest(value, board, session)).toThrow('建议请求')
  })

  it('拒绝在请求意图里引用其他讨论的观点', async () => {
    const { validateSuggestionRequest } = await import('./agent-actions')
    const foreignBoard = structuredClone(board)
    foreignBoard.nodes[0].data.ideaMeta!.sessionId = 'another-discussion'
    expect(() => validateSuggestionRequest({ purpose: '整理', ideaIds: ['idea-a'] }, foreignBoard, session)).toThrow('建议请求')
  })
})

function completion(content: unknown = JSON.stringify(validResponse)) {
  return new Response(JSON.stringify({ id: 'completion-a', object: 'chat.completion', model: 'configured-model',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }),
    { headers: { 'Content-Type': 'application/json' } })
}

describe('DeepSeek 服务端适配', () => {
  beforeEach(() => { vi.stubEnv('DEEPSEEK_MODEL', 'configured-model') })
  it('没有 Key 时明确失败且不发出请求', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    vi.stubGlobal('fetch', () => { throw new Error('不应发起网络请求') })
    const { requestDeepSeekSuggestions } = await import('./deepseek')
    await expect(requestDeepSeekSuggestions({ board, session }, { purpose: '整理' })).rejects.toThrow('DEEPSEEK_API_KEY')
  })

  it('使用配置的服务地址和模型，只向上游发送真实上下文与明确意图', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-server-only-key')
    vi.stubEnv('DEEPSEEK_BASE_URL', 'https://provider.example/v1/')
    vi.stubEnv('DEEPSEEK_MODEL', 'configured-model')
    vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
      expect(url).toBe('https://provider.example/v1/chat/completions')
      expect(options.method).toBe('POST')
      expect(options.headers).toEqual({ Authorization: 'Bearer test-server-only-key', 'Content-Type': 'application/json' })
      const payload = JSON.parse(options.body as string)
      expect(payload.model).toBe('configured-model')
      expect(payload.response_format).toEqual({ type: 'json_object' })
      expect(payload.stream).toBe(false)
      expect(payload.messages[0]).toMatchObject({ role: 'system' })
      expect(payload.messages[0].content).toContain('JSON')
      expect(JSON.parse(payload.messages[1].content)).toEqual({ session, board, intent: { purpose: '整合', ideaIds: ['idea-a', 'idea-b'] } })
      return completion()
    })
    const { requestDeepSeekSuggestions } = await import('./deepseek')
    expect(await requestDeepSeekSuggestions({ board, session }, { purpose: '整合', ideaIds: ['idea-a', 'idea-b'] })).toEqual(validResponse)
  })

  it('未配置服务地址时使用 DeepSeek 官方入口', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-server-only-key')
    vi.stubEnv('DEEPSEEK_BASE_URL', '')
    vi.stubEnv('DEEPSEEK_MODEL', 'configured-model')
    vi.stubGlobal('fetch', async (url: string) => {
      expect(url).toBe('https://api.deepseek.com/chat/completions')
      return completion()
    })
    const { requestDeepSeekSuggestions } = await import('./deepseek')
    expect(await requestDeepSeekSuggestions({ board, session }, { purpose: '整理' })).toEqual(validResponse)
  })

  it.each([undefined, '', ' ', 'model\nname'])('缺少或非法模型配置时明确失败：%j', async (model) => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-server-only-key')
    vi.stubEnv('DEEPSEEK_MODEL', model)
    vi.stubGlobal('fetch', async () => completion())
    const { requestDeepSeekSuggestions } = await import('./deepseek')
    await expect(requestDeepSeekSuggestions({ board, session }, { purpose: '整理' })).rejects.toThrow('DEEPSEEK_MODEL')
  })

  it.each(['not-a-url', 'ftp://provider.example', 'https://user:secret@provider.example', 'https://provider.example?unexpected=query', 'https://provider.example#fragment'])('非法服务地址配置时明确失败：%s', async (base) => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-server-only-key')
    vi.stubEnv('DEEPSEEK_BASE_URL', base)
    vi.stubGlobal('fetch', async () => completion())
    const { requestDeepSeekSuggestions } = await import('./deepseek')
    await expect(requestDeepSeekSuggestions({ board, session }, { purpose: '整理' })).rejects.toThrow('DEEPSEEK_BASE_URL')
  })

  it('HTTP 失败明确报错且不把上游正文暴露给客户端', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-server-only-key')
    vi.stubGlobal('fetch', async () => new Response('test-server-only-key', { status: 429 }))
    const { requestDeepSeekSuggestions } = await import('./deepseek')
    await expect(requestDeepSeekSuggestions({ board, session }, { purpose: '整理' })).rejects.toThrow('HTTP 429')
    await expect(requestDeepSeekSuggestions({ board, session }, { purpose: '整理' })).rejects.not.toThrow('test-server-only-key')
  })

  it('网络失败明确报错且不会生成替代回复', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-server-only-key')
    vi.stubGlobal('fetch', async () => { throw new Error('network detail test-server-only-key') })
    const { requestDeepSeekSuggestions } = await import('./deepseek')
    await expect(requestDeepSeekSuggestions({ board, session }, { purpose: '整理' })).rejects.toThrow('DeepSeek 网络请求失败')
  })

  it('拒绝非 JSON 上游响应', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-server-only-key')
    vi.stubGlobal('fetch', async () => new Response('<html>error</html>'))
    const { requestDeepSeekSuggestions } = await import('./deepseek')
    await expect(requestDeepSeekSuggestions({ board, session }, { purpose: '整理' })).rejects.toThrow('JSON')
  })

  it('拒绝用数字属性对象冒充 choices 数组，即使内部是合法建议', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-server-only-key')
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ choices: { 0: { message: { content: JSON.stringify(validResponse) } } } })))
    const { requestDeepSeekSuggestions } = await import('./deepseek')
    const { AgentValidationError } = await import('./agent-actions')
    await expect(requestDeepSeekSuggestions({ board, session }, { purpose: '整理' })).rejects.toBeInstanceOf(AgentValidationError)
  })

  it.each([
    null, [], {}, { choices: null }, { choices: [] }, { choices: [null] }, { choices: [[]] }, { choices: ['not-an-object'] },
    { choices: [{}] }, { choices: [{ message: null }] }, { choices: [{ message: [] }] }, { choices: [{ message: 'not-an-object' }] },
    { choices: [{ message: {} }] }, { choices: [{ message: { content: 1 } }] }, { choices: [{ message: { content: '' } }] },
    { choices: [{ message: { content: '   ' } }] },
  ])('拒绝缺失或错误类型的上游 JSON 结构：%j', async (envelope) => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-server-only-key')
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(envelope)))
    const { requestDeepSeekSuggestions } = await import('./deepseek')
    const { AgentValidationError } = await import('./agent-actions')
    await expect(requestDeepSeekSuggestions({ board, session }, { purpose: '整理' })).rejects.toBeInstanceOf(AgentValidationError)
  })

  it.each(['', ' ', null, '{invalid', '```json\n{}\n```', '{}', '{"message":"说明"}', '{"message":"说明","actions":[]}',
    JSON.stringify({ message: '错误动作', actions: [{ type: 'delete_ideas' }] }),
    JSON.stringify({ message: '跨讨论动作', actions: [{ type: 'create_cluster', label: '分组', ideaIds: ['foreign-idea'] }] }),
  ])('拒绝空、非 JSON 或不合法的模型内容：%j', async (content) => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-server-only-key')
    vi.stubGlobal('fetch', async () => completion(content))
    const { requestDeepSeekSuggestions } = await import('./deepseek')
    await expect(requestDeepSeekSuggestions({ board, session }, { purpose: '整理' })).rejects.toThrow()
  })
})
