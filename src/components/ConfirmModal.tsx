import { useId, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { WarningCircle, X } from '@phosphor-icons/react'

type Props = {
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({ title, description, confirmLabel, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useLayoutEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const initialFocusTarget = cancelButtonRef.current ?? dialogRef.current
    initialFocusTarget?.focus()

    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keep modal keystrokes from reaching the workspace's global shortcuts.
    event.stopPropagation()

    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }

    if (event.key !== 'Tab') return

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
    ) ?? [])

    event.preventDefault()
    if (focusable.length === 0) {
      dialogRef.current?.focus()
      return
    }

    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement)
    const nextIndex = event.shiftKey
      ? currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1
      : currentIndex === -1 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1
    focusable[nextIndex].focus()
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section
        ref={dialogRef}
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <div className="confirm-modal-icon"><WarningCircle size={22} weight="fill" /></div>
        <button type="button" className="icon-button confirm-modal-close" onClick={onCancel} aria-label="Close dialog"><X size={17} /></button>
        <span className="panel-kicker">Please confirm</span>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        <div className="confirm-modal-actions">
          <button ref={cancelButtonRef} type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button type="button" className="confirm-action-button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  )
}
