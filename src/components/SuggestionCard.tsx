import { useState } from 'react'
import type { AgentActionType, AgentSuggestion, BoardNode } from '../types'

const ACTION_LABELS: Record<AgentActionType, string> = { create_cluster: '建立分类', connect_ideas: '连接观点', ask_question: '提出问题', suggest_merge: '创建候选方案', create_matrix: '建立决策矩阵', create_summary: '创建成果草稿' }
const FIELD_LABELS: Record<string, string> = { label: '分类名或关系标签', question: '问题文本', title: '方案标题', content: '方案说明', logic: '组合逻辑', risks: '方案风险', openQuestions: '待确认事项', criteria: '矩阵标准', summary: '草稿文本' }
const TRIGGERS: Record<AgentSuggestion['trigger'], string> = { similar_ideas: '重复观点分析', quiet_period: '停滞或用户求助', complementary_ideas: '互补观点', manual: '用户求助', stage: '服务端阶段建议', board_change: '服务端白板建议' }

export function SuggestionCard({ suggestion, nodes, busy, onSave, onStatus, onAccept, onPause }: { suggestion: AgentSuggestion; nodes: BoardNode[]; busy: boolean; onSave: (suggestion: AgentSuggestion) => boolean; onStatus: (status: 'ignored' | 'deferred' | 'pending') => void; onAccept: () => void; onPause: () => void }) {
  const [draft, setDraft] = useState<AgentSuggestion | null>(null)
  const item = draft ?? suggestion
  return <section className="proposal-card" aria-label="待确认 AI 建议">
    <p>触发原因：{TRIGGERS[item.trigger]}</p>
    <p>{item.status === 'deferred' ? '稍后处理' : '待确认 · 尚未执行'}</p>
    {draft ? <label>建议说明<textarea value={item.message} onChange={(event) => setDraft({ ...item, message: event.target.value })} /></label> : <p>{item.message}</p>}
    {item.actions.map((action, index) => {
      const ids = action.type === 'connect_ideas' ? [action.fromId as string, action.toId as string] : Array.isArray(action.ideaIds) ? action.ideaIds as string[] : item.selectedIdeaIds ?? []
      return <section key={index} aria-label={`动作 ${index + 1}`}>
        <h4>{ACTION_LABELS[action.type]}</h4>
        <p>涉及观点：{ids.length ? ids.map((id) => `${nodes.find((node) => node.id === id)?.data.title || '未命名观点'}（${id}）`).join('、') : '当前讨论'}</p>
        {Object.entries(action).filter(([key]) => FIELD_LABELS[key]).map(([key, value]) => {
          const text = Array.isArray(value) ? value.join('\n') : String(value)
          const label = key === 'title' && action.type === 'create_matrix' ? '矩阵标题' : key === 'label' ? action.type === 'create_cluster' ? '分类名' : '关系标签' : FIELD_LABELS[key]
          return draft ? <label key={key}>{label}<textarea value={text} onChange={(event) => setDraft({ ...item, actions: item.actions.map((entry, i) => i === index ? { ...entry, [key]: Array.isArray(value) ? event.target.value.split('\n') : event.target.value } : entry) })} /></label> : <p key={key}>{label}：{text || '无'}</p>
        })}
      </section>
    })}
    <div className="proposal-actions">
      {draft ? <><button type="button" disabled={busy} onClick={() => { if (onSave(item)) setDraft(null) }}>保存建议</button><button type="button" onClick={() => setDraft(null)}>取消编辑</button></> : item.status === 'deferred' ? <button type="button" disabled={busy} onClick={() => onStatus('pending')}>继续处理建议</button> : <><button type="button" disabled={busy} onClick={onAccept}>接受建议</button><button type="button" disabled={busy} onClick={() => setDraft(structuredClone(suggestion))}>编辑建议</button><button type="button" disabled={busy} onClick={() => onStatus('deferred')}>稍后处理</button></>}
      <button type="button" disabled={busy} onClick={() => onStatus('ignored')}>忽略建议</button>
      <button type="button" disabled={busy} onClick={onPause}>本阶段暂停提醒</button>
    </div>
  </section>
}
