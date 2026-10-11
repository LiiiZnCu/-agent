import { useId, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { ArrowClockwise, Check, Copy, Link, ShareNetwork, X } from '@phosphor-icons/react'

type Props = {
  role: 'owner' | 'user' | 'agent' | null
  isHosted: boolean
  shareUrl: string
  loading: boolean
  copied: boolean
  error: string
  onPublish: () => void
  onGenerate: () => void
  onCopy: () => void
  onClose: () => void
}

export function ShareModal({ role, isHosted, shareUrl, loading, copied, error, onPublish, onGenerate, onCopy, onClose }: Props) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])
    if (!focusable.length) return
    event.preventDefault()
    const index = focusable.indexOf(document.activeElement as HTMLElement)
    const next = event.shiftKey
      ? index <= 0 ? focusable.length - 1 : index - 1
      : index < 0 || index === focusable.length - 1 ? 0 : index + 1
    focusable[next].focus()
  }

  const title = !isHosted ? '分享此白板' : role === 'agent' ? '由所有者管理分享' : '协作者链接'
  const description = !isHosted
    ? '发布当前画布的副本，生成私密协作者链接。'
    : role === 'owner'
      ? '持有此私密链接的人可加入并编辑白板。生成新链接后，旧链接将失效。'
      : role === 'user'
        ? '复制当前协作者链接，邀请其他人以相同权限加入。'
        : '智能体邀请链接不会公开。请让白板所有者生成协作者链接。'

  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={handleKeyDown} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="share-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <div className="share-modal-icon"><ShareNetwork size={22} weight="fill" /></div>
        <button ref={closeRef} type="button" className="icon-button share-modal-close" onClick={onClose} aria-label="关闭分享弹窗"><X size={17} /></button>
        <span className="panel-kicker">私密访问</span>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>

        {shareUrl && (
          <div className="share-link-field">
            <Link size={16} aria-hidden="true" />
            <input aria-label="协作者链接" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
            <button type="button" onClick={onCopy}>{copied ? <Check size={16} weight="bold" /> : <Copy size={16} />}<span>{copied ? '已复制' : '复制'}</span></button>
          </div>
        )}

        {error && <div className="share-modal-error" role="alert">{error}</div>}

        <div className="share-modal-actions">
          {!isHosted && <button type="button" className="share-primary" onClick={onPublish} disabled={loading}>{loading ? '正在发布…' : '发布并生成链接'}</button>}
          {isHosted && role === 'owner' && (
            <button type="button" className={shareUrl ? 'secondary-button' : 'share-primary'} onClick={onGenerate} disabled={loading}>
              {shareUrl && <ArrowClockwise size={15} />}{loading ? '正在生成…' : shareUrl ? '生成新链接' : '生成协作者链接'}
            </button>
          )}
          <button type="button" className="secondary-button" onClick={onClose}>完成</button>
        </div>
      </section>
    </div>
  )
}
