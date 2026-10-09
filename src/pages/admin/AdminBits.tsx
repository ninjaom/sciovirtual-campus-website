import type { ReactNode } from 'react'
import './admin.css'

/** Page title row: small grey line above the blue title, actions on the right. */
export function AdminHead({ eyebrow, title, children }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="ahead">
      <div className="ahead__text">
        {eyebrow && <span className="ahead__eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
      </div>
      {children && <div className="ahead__actions">{children}</div>}
    </div>
  )
}

/** A grey row in a list (reminders, quick links, overrides). */
export function ListRow({ title, sub, children, handle }: { title: ReactNode; sub?: ReactNode; children?: ReactNode; handle?: ReactNode }) {
  return (
    <div className="lrow">
      {handle}
      <div className="lrow__text">
        <span className="lrow__title">{title}</span>
        {sub && <span className="lrow__sub">{sub}</span>}
      </div>
      {children}
    </div>
  )
}

export function Chip({ children, onRemove, removeLabel }: { children: ReactNode; onRemove?: () => void; removeLabel?: string }) {
  return (
    <span className="chip">
      {children}
      {onRemove && (
        <button type="button" className="chip__x" aria-label={removeLabel ?? 'Remove'} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <span className="anote">{children}</span>
}

export function LoadError({ message }: { message: string }) {
  return (
    <div role="alert" className="aerror">
      Something went wrong loading this page. ({message})
    </div>
  )
}
