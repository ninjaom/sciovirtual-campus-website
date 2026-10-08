import { NavLink, Outlet, useLocation } from 'react-router'
import { ADMIN_SECTIONS } from './nav'
import './AdminLayout.css'

export function AdminLayout() {
  const { pathname } = useLocation()
  const current = ADMIN_SECTIONS.find((s) => (s.to === '/admin' ? pathname === '/admin' : pathname.startsWith(s.to))) ?? ADMIN_SECTIONS[0]
  return (
    <div className="admin page page--wide">
      <aside className="admin__side">
        <p className="admin__eyebrow">ADMIN</p>
        <nav aria-label="Admin sections" className="admin__nav">
          {ADMIN_SECTIONS.map((s) => (
            <NavLink key={s.to} to={s.to} end={s.to === '/admin'} className={({ isActive }) => 'admin__link' + (isActive ? ' is-active' : '')}>
              {s.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      {/* Phones: the sidebar becomes a dropdown */}
      <div className="dd admin__dd">
        <button type="button" className="admin__ddbtn" aria-haspopup="true">
          <span className="admin__ddtext">
            <span className="admin__ddeyebrow">ADMIN</span>
            <span className="admin__ddcur">{current.label}</span>
          </span>
          <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <div className="dd__menu admin__ddmenu" role="menu">
          {ADMIN_SECTIONS.map((s) => (
            <NavLink key={s.to} to={s.to} end={s.to === '/admin'} className={({ isActive }) => 'admin__link' + (isActive ? ' is-active' : '')}>
              {s.label}
            </NavLink>
          ))}
        </div>
      </div>
      <main className="admin__main">
        <Outlet />
      </main>
    </div>
  )
}
