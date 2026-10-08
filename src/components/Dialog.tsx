import { useEffect, useId, useRef, type ReactNode } from 'react'
import './Dialog.css'

/**
 * Shared pop-up panel. Uses the native <dialog> element for focus handling,
 * Escape to close and the dimmed background. It grows from the button that
 * opened it (Design rules) when `origin` is given.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 440,
  origin,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: number
  origin?: HTMLElement | null
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      if (origin) {
        const r = origin.getBoundingClientRect()
        const cx = r.left + r.width / 2 - window.innerWidth / 2
        const cy = r.top + r.height / 2 - window.innerHeight / 2
        d.style.setProperty('--from', `translate(${cx}px, ${cy}px) scale(0.6)`)
      } else {
        d.style.setProperty('--from', 'translateY(8px) scale(0.97)')
      }
      d.showModal()
    } else if (!open && d.open) {
      d.close()
      origin?.focus()
    }
  }, [open, origin])

  return (
    <dialog
      ref={ref}
      className="dlg"
      aria-labelledby={titleId}
      style={{ maxWidth: width }}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        // Click on the dimmed background closes.
        if (e.target === ref.current) onClose()
      }}
    >
      {open && (
        <div className="dlg__panel">
          <div className="dlg__head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="dlg__close" aria-label="Close" onClick={onClose}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {children}
          {footer && <div className="dlg__foot">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
