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

  const title = !isHosted ? 'Share this mural' : role === 'agent' ? 'Owner-managed sharing' : 'Collaborator link'
  const description = !isHosted
    ? 'Publish a copy of the current canvas to create a private collaborator URL.'
    : role === 'owner'
      ? 'Anyone with this private link can join and edit the mural. Creating a fresh link revokes the previous collaborator link.'
      : role === 'user'
        ? 'Copy your current collaborator URL to invite another person with the same access.'
        : 'Agent invitation links stay private. Ask the mural owner to create a collaborator link.'

  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={handleKeyDown} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="share-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <div className="share-modal-icon"><ShareNetwork size={22} weight="fill" /></div>
        <button ref={closeRef} type="button" className="icon-button share-modal-close" onClick={onClose} aria-label="Close share dialog"><X size={17} /></button>
        <span className="panel-kicker">Private access</span>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>

        {shareUrl && (
          <div className="share-link-field">
            <Link size={16} aria-hidden="true" />
            <input aria-label="Collaborator URL" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
            <button type="button" onClick={onCopy}>{copied ? <Check size={16} weight="bold" /> : <Copy size={16} />}<span>{copied ? 'Copied' : 'Copy'}</span></button>
          </div>
        )}

        {error && <div className="share-modal-error" role="alert">{error}</div>}

        <div className="share-modal-actions">
          {!isHosted && <button type="button" className="share-primary" onClick={onPublish} disabled={loading}>{loading ? 'Publishing…' : 'Publish and create link'}</button>}
          {isHosted && role === 'owner' && (
            <button type="button" className={shareUrl ? 'secondary-button' : 'share-primary'} onClick={onGenerate} disabled={loading}>
              {shareUrl && <ArrowClockwise size={15} />}{loading ? 'Creating…' : shareUrl ? 'Create fresh link' : 'Create collaborator link'}
            </button>
          )}
          <button type="button" className="secondary-button" onClick={onClose}>Done</button>
        </div>
      </section>
    </div>
  )
}
