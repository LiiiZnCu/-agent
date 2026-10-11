// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BoardLibraryMenu } from './BoardLibraryMenu'
import { ConfirmModal } from './ConfirmModal'
import { ToolRail } from './ToolRail'

describe('组件中文界面', () => {
  it('白板菜单的创建入口和空状态不显示英文', () => {
    render(<BoardLibraryMenu boards={[]} currentId="" onNew={vi.fn()} onSelect={vi.fn()} onOpenInstance={vi.fn()} onImport={vi.fn()} />)
    expect(screen.getByRole('button', { name: '新建白板' })).toBeTruthy()
    expect(screen.getByText('0 个白板保存在本地')).toBeTruthy()
    expect(screen.queryByText('Your murals')).toBeNull()
  })

  it('工具栏的可见提示使用中文', () => {
    render(<ToolRail onAdd={vi.fn()} onArtifact={vi.fn()} />)
    expect(screen.getByRole('button', { name: '添加观点' })).toBeTruthy()
    expect(screen.getByText('决策矩阵')).toBeTruthy()
    expect(screen.queryByText('Decision matrix')).toBeNull()
  })

  it('确认弹窗的固定提示和取消按钮使用中文', () => {
    render(<ConfirmModal title="删除白板" description="删除后无法恢复" confirmLabel="删除" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('请确认')).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
    expect(screen.queryByText('Please confirm')).toBeNull()
  })
})
