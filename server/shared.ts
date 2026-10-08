// Shared by the browser app and the server functions.

/** Sign-in address built from a person's ID. It never receives mail. */
export function internalEmail(personCode: string): string {
  return `${personCode.trim().toLowerCase()}@accounts.campus.sciovirtual.org`
}

/** "k7q2 9mxd" -> "K7Q2-9MXD" */
export function normalizeCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s
}

export function normalizeId(raw: string): string {
  return raw.trim().toUpperCase()
}

export const USERNAME_RE = /^[A-Za-z0-9_.]{3,24}$/
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MIN_PASSWORD = 8

export type SignUpError =
  | 'invalid_code'
  | 'rate_limited'
  | 'username_taken'
  | 'username_format'
  | 'password_short'
  | 'email_format'
  | 'server'

export interface CheckCodeResult {
  ok: boolean
  error?: SignUpError
  kind?: 'new' | 'reset'
  role?: 'student' | 'instructor' | 'admin'
}
