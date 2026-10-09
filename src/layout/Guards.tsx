import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../lib/auth'
import type { Role } from '../lib/types'

function Loading() {
  return <div className="boot" aria-busy="true" />
}

/** Signed-in users only; optionally limited to some roles. */
export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { loading, session, profile } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!session || !profile) return <Navigate to="/" replace state={{ from: location.pathname }} />
  if (roles && !roles.includes(profile.role)) return <Navigate to="/home" replace />
  return <>{children}</>
}

/** Signed-out pages (sign-in, sign-up); signed-in users go home. */
export function SignedOutOnly({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth()
  if (loading) return <Loading />
  // Admins land on the Admin page; everyone else on Home.
  if (session && profile) return <Navigate to={profile.role === 'admin' ? '/admin' : '/home'} replace />
  return <>{children}</>
}
