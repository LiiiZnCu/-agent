import { useState } from 'react'
import { createId } from '../lib/board'
import type { BrainstormSession } from '../types'

export function MemberControls({ session, onChange }: { session: BrainstormSession; onChange: (session: BrainstormSession) => void }) {
  const [name, setName] = useState('')
  return <section aria-label="讨论成员">
    <label>当前成员<select value={session.currentMemberId} onChange={(event) => onChange({ ...session, currentMemberId: event.target.value })}>{session.members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
    <form onSubmit={(event) => {
      event.preventDefault()
      if (!name.trim()) return
      onChange({ ...session, members: [...session.members, { id: createId('member'), name: name.trim(), role: 'member', joinedAt: new Date().toISOString() }] })
      setName('')
    }}><label>新成员昵称<input required value={name} onChange={(event) => setName(event.target.value)} /></label><button disabled={!name.trim()}>添加成员</button></form>
  </section>
}
