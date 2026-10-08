import type { ReactNode } from 'react'
import { Link } from 'react-router'
import './auth.css'

/** Blue full-page backdrop with the sign-in card style. */
export function AuthLayout({ children, wide, showSiteLink }: { children: ReactNode; wide?: boolean; showSiteLink?: boolean }) {
  return (
    <div className="auth">
      <header className="auth__hdr">
        {showSiteLink ? (
          <a href="https://www.sciovirtual.org" className="auth__brand">
            <img src="/logo.svg" alt="ScioVirtual logo" width={36} height={36} />
            <span>ScioVirtual</span>
          </a>
        ) : (
          <Link to="/" className="auth__brand">
            <img src="/logo.svg" alt="ScioVirtual logo" width={36} height={36} />
            <span>ScioVirtual</span>
          </Link>
        )}
        {showSiteLink && (
          <a href="https://www.sciovirtual.org" className="auth__site">
            sciovirtual.org
          </a>
        )}
      </header>
      <main className="auth__main">
        <div className={'auth__card' + (wide ? ' auth__card--wide' : '')}>{children}</div>
      </main>
    </div>
  )
}

export function AuthIntro({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="auth__intro">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  )
}
