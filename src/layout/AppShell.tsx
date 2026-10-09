import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../lib/auth'
import { initials } from '../lib/format'
import type { Profile } from '../lib/types'
import { navFor, type NavEntry, type NavLink as NavLinkT } from './nav'
import './AppShell.css'

function Avatar({ profile, size }: { profile: Profile; size: number }) {
  return (
    <span className={`avatar avatar--${profile.role}`} style={{ width: size, height: size }} aria-hidden="true">
      {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : initials(profile.firstName, profile.lastName)}
    </span>
  )
}

function Chevron() {
  return (
    <svg className="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function ItemLink({ item, className, onClick }: { item: NavLinkT; className: string; onClick?: () => void }) {
  if (item.external) {
    return (
      <a className={className} href={item.to} target="_blank" rel="noreferrer" onClick={onClick}>
        {item.label}
      </a>
    )
  }
  return (
    <NavLink className={({ isActive }) => className + (isActive ? ' is-active' : '')} to={item.to} onClick={onClick}>
      {item.label}
    </NavLink>
  )
}

function DesktopNav({ entries, profile }: { entries: NavEntry[]; profile: Profile }) {
  const { pathname } = useLocation()
  return (
    <nav aria-label="Main" className="topnav">
      {entries.map((e) =>
        e.kind === 'link' ? (
          <ItemLink key={e.label} item={e} className="topnav__link" />
        ) : (
          <div key={e.label} className={'dd' + (e.items.some((i) => pathname.startsWith(i.to)) ? ' is-active' : '')}>
            <button type="button" className="topnav__link dd__btn" aria-haspopup="true">
              {e.label} <Chevron />
            </button>
            <div className="dd__menu" role="menu">
              {e.items.map((i) => (
                <ItemLink key={i.label + i.to} item={i} className="dd__item" />
              ))}
            </div>
          </div>
        ),
      )}
      <NavLink to="/account" className={({ isActive }) => 'acct' + (isActive ? ' is-active' : '')} aria-label="Account">
        <Avatar profile={profile} size={30} />
        <span>{profile.role === 'student' ? profile.firstName : `${profile.firstName} ${profile.lastName}`}</span>
      </NavLink>
    </nav>
  )
}

function PhoneMenu({ entries, profile, onClose }: { entries: NavEntry[]; profile: Profile; onClose: () => void }) {
  return (
    <nav aria-label="Main" className="pmenu">
      {entries.map((e) =>
        e.kind === 'link' ? (
          <ItemLink key={e.label} item={e} className="pmenu__link" onClick={onClose} />
        ) : (
          <div key={e.label} className="pmenu__group">
            <span className="pmenu__label">{e.label}</span>
            {e.items.map((i) => (
              <ItemLink key={i.label + i.to} item={i} className="pmenu__link pmenu__link--sub" onClick={onClose} />
            ))}
          </div>
        ),
      )}
      <Link to="/account" className="pmenu__acct" onClick={onClose}>
        <Avatar profile={profile} size={32} />
        {profile.firstName} {profile.lastName}
      </Link>
    </nav>
  )
}

export function AppShell() {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  if (!profile) return null
  const entries = navFor(profile)

  return (
    <div className="shell">
      <header className="hdr">
        <div className="hdr__bar">
          <Link to="/home" className="brand">
            <img src="/logo.svg" alt="ScioVirtual logo" width={34} height={34} />
            <span>ScioVirtual</span>
          </Link>
          <DesktopNav entries={entries} profile={profile} />
          <button
            type="button"
            className={'menubtn' + (open ? ' is-open' : '')}
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
        {open && <PhoneMenu entries={entries} profile={profile} onClose={() => setOpen(false)} />}
      </header>
      <Outlet />
    </div>
  )
}
