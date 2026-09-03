// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { BoardActions, RecordingActions } from '../types'
import { registerWebMCP, TOOL_CATALOG } from './webmcp'

type CapturedTool = {
  name: string
  inputSchema?: Record<string, unknown>
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown
}

describe('WebMCP registration', () => {
  it('registers the complete surface and exposes Artifact Spec directly', async () => {
    const tools: CapturedTool[] = []
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: { registerTool: (tool: CapturedTool) => tools.push(tool) },
    })
    const actions = {
      getSnapshot: vi.fn(() => ({ name: 'Test', nodes: [], edges: [], updatedAt: 'now' })),
    } as unknown as BoardActions
    const recording = { getRecording: vi.fn(() => null) } as unknown as RecordingActions

    const registration = registerWebMCP(actions, recording, vi.fn())

    expect(registration.supported).toBe(true)
    expect(registration.count).toBe(TOOL_CATALOG.length)
    expect(tools.map((tool) => tool.name)).toContain('canvas_create_artifact')
    expect(tools.map((tool) => tool.name)).toContain('canvas_record_contribution')

    const artifactTool = tools.find((tool) => tool.name === 'canvas_create_artifact')!
    const properties = artifactTool.inputSchema?.properties as Record<string, unknown>
    const artifactSchema = properties.spec as { properties: Record<string, unknown> }
    expect(artifactSchema.properties).toHaveProperty('artifactType')
    expect(artifactSchema.properties).not.toHaveProperty('spec')

    const boardTool = tools.find((tool) => tool.name === 'canvas_get_board')!
    const output = await boardTool.execute({}) as { structuredContent: { board: { name: string } } }
    expect(output.structuredContent.board.name).toBe('Test')
    registration.cleanup()
  })
})
